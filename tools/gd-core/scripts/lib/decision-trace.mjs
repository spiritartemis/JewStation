/**
 * 决策抽象层 · 观测基元（core）
 *
 * 权威源：docs/gd-decision-abstraction-layer-design.md §9（观测与数据积累）
 *
 * 落位（已按实测修正，设计稿 §9.1 原写 `<板根>/events/decisions.jsonl`）：
 *   `<板根>/decisions.jsonl` —— 与项目级事件流 `<板根>/events.jsonl` **平级**，
 *   板上没有 `events/` 子目录（`board.mjs: eventsPathOf` 返回的就是 `<板根>/events.jsonl`）。
 *
 * 三件职责，各管一段，别混：
 *   1. `hashDecisionInput`：输入指纹（脱敏后的规范化 JSON 的 sha256）——可复算、不可逆；
 *   2. `redactDecisionCase` / `redactDecisionContext`：**默认不落敏感内容**（原始 prompt / 交付物全文 / 凭据）；
 *   3. `appendDecisionEvent`：追加写一行（走板锁，与其它写账同一条锁）。
 *
 * 0.33.1 追加第四件：**后验标签**（`labels.jsonl` + `labelOf` + `applyLabels`）。
 *   标签单独一个文件、按 `trace_id` 合并进调用行——理由见 `LABELS_FILE` 注释。
 *   口径单一实现在 `labelOf`，验收流程（`board-ledger.applyTransition`）只调它，不各自判。
 *
 * 为什么不落原始 prompt：设计稿 §9.2 明确默认不落。要调试就开本机临时开关写到 gitignore 目录，
 *   而不是把长上下文塞进板账——板账会跟着仓走。
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { nowIso, withBoardLock } from "./board.mjs";
import { readBoardConfig } from "./board-resolve.mjs";

/** 观测文件（板根平级） */
export const DECISIONS_FILE = "decisions.jsonl";

/**
 * 后验标签文件（板根平级 · 0.33.1 R-gm-33-1）。
 *
 * 为什么**另起一个文件**而不是往 `decisions.jsonl` 里追加「标签行」：
 *   `decisions.jsonl` 的每一行都等于一次 provider 调用，读侧（eval / feed / show / 工位台）
 *   全都按「行数 = 调用数」在算。标签行混进去，调用量、延迟分位数、成本立刻全错，
 *   而且每加一个读侧就得记得过滤一次——这类「每个读者都要记住的隐形约定」迟早有人漏。
 *   分开存：调用行永远只是调用行，标签按 `trace_id` 合并，读侧只在一个地方合并。
 */
export const LABELS_FILE = "labels.jsonl";

/** 后验标签全集（与 decision.schema.json 的 DecisionEvent.label / DecisionLabel.label 同源） */
export const LABELS = ["accepted", "rejected", "rework", "overridden"];

/**
 * 哪个标签算「决策建议正确」。
 *
 * 为什么只认 `accepted`：`label` 记的是**业务最终结论**，不是「模型是否答对了标准答案」——
 *   我们并没有 ground truth，只有「这条建议后来被采纳了吗」。
 *   所以这里量的其实是**采纳率**，读面必须把这句话说出来（见 decision-eval 的 ACCURACY_WHY），
 *   不许挂个「准确率」的牌子让人误以为是分类精度。
 */
export const POSITIVE_LABEL = "accepted";

/** 长字符串截断阈值（超过即截断并标原长；防交付物全文被顺手塞进 context） */
export const MAX_STRING = 500;

/** 按键名判定为敏感的键（命中即整体替换为 "[redacted]"） */
const SENSITIVE_KEY_RE = /(api[-_]?key|apikey|token|secret|password|passwd|credential|authorization|cookie|headers?|prompt|raw|body|content|text|diff|patch|deliverable|file_content|stdout|stderr)/i;

const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * 递归脱敏 + 长串截断。
 * 键名命中敏感词 ⇒ 整棵子树替换成 `"[redacted]"`（不保留形状，避免「按长度猜内容」）。
 * @param {unknown} value
 * @param {number} [depth] 内部用（防御自引用 / 过深结构）
 */
export function redactDecisionContext(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…(len=${value.length})` : value;
  if (typeof value !== "object") return value;
  if (depth > 6) return "[depth-limit]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactDecisionContext(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = "[redacted]";
      continue;
    }
    out[k] = redactDecisionContext(v, depth + 1);
  }
  return out;
}

/** 稳定序列化（键排序；同内容必得同 hash） */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObj(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

/** 脱敏后的 DecisionCase（hash 与落盘都以它为准，保证同一输入永远同一指纹） */
export function redactDecisionCase(decisionCase) {
  return {
    kind: String(decisionCase?.kind ?? "").trim(),
    subject: redactDecisionContext(decisionCase?.subject ?? {}),
    options: (Array.isArray(decisionCase?.options) ? decisionCase.options : []).map((o) => ({ id: String(o?.id ?? ""), attrs: redactDecisionContext(o?.attrs ?? {}) })),
    context: redactDecisionContext(decisionCase?.context ?? {}),
    policy: decisionCase?.policy ?? null,
  };
}

/**
 * 输入指纹：`sha256:<64hex>`（对脱敏后的规范化 JSON）。
 * @param {object} decisionCase
 */
export function hashDecisionInput(decisionCase) {
  const h = createHash("sha256").update(canonical(redactDecisionCase(decisionCase)), "utf8").digest("hex");
  return `sha256:${h}`;
}

/** 日期键（trace_id 用；本机时区，人读友好） */
export function dateKeyOf(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/**
 * 生成 trace_id：`D-<板id>-<YYYYMMDD>-<4位序号>`（序号在当天内自增）。
 * @param {string} boardId
 * @param {string} dateKey
 * @param {number} seq 1 起
 */
export function traceIdOf(boardId, dateKey, seq) {
  const id = String(boardId ?? "").trim() || "board";
  return `D-${id}-${dateKey}-${String(seq).padStart(4, "0")}`;
}

/** 读全部决策事件（只读；坏行跳过——观测数据不该让读侧崩） */
export function readDecisionEvents(boardRoot, { kind = null, provider = null, labels = true } = {}) {
  const p = join(String(boardRoot), DECISIONS_FILE);
  if (!existsSync(p)) return [];
  const rows = [];
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t);
      if (kind && e.kind !== kind) continue;
      if (provider && e.provider !== provider) continue;
      rows.push(e);
    } catch {
      /* 坏行跳过 */
    }
  }
  // 标签在**这里**合并（唯一合并点）：调用方拿到的行永远带当前标签，不必自己记得去读 labels.jsonl
  return labels ? applyLabels(rows, readDecisionLabels(boardRoot)) : rows;
}

/**
 * 读全部后验标签行（只读；坏行跳过）。文件不存在 = 还没人回填过，返回空数组。
 * @param {string} boardRoot
 * @returns {object[]}
 */
export function readDecisionLabels(boardRoot) {
  const p = join(String(boardRoot), LABELS_FILE);
  if (!existsSync(p)) return [];
  const rows = [];
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t);
      if (e && typeof e === "object" && e.trace_id) rows.push(e);
    } catch {
      /* 坏行跳过 */
    }
  }
  return rows;
}

/**
 * 把标签行合并进调用行（**同一 trace 多条标签时最后一条赢**）。
 *
 * 为什么允许「多条」而不是覆盖旧行：`labels.jsonl` 是追加式账本（与 artifacts 段同一套理由）——
 *   一个任务被打回后又通过，标签就该从 `rejected` 变成 `rework`；**历史要留着**（审计要看改口过程），
 *   当前真相由读侧按时间取最后一条。覆盖写会把「曾经判过 rejected」这件事抹掉。
 *
 * @param {object[]} events 调用行
 * @param {object[]} labels 标签行
 * @returns {object[]} 合并后的调用行（原对象不改）
 */
export function applyLabels(events, labels) {
  if (!Array.isArray(events) || events.length === 0) return events ?? [];
  if (!Array.isArray(labels) || labels.length === 0) return events;
  const latest = new Map();
  for (const l of labels) {
    const id = String(l?.trace_id ?? "");
    if (!id || !LABELS.includes(String(l.label))) continue;
    const prev = latest.get(id);
    // 同一时间戳取后出现的那条（文件顺序 = 写入顺序）
    if (!prev || String(l.time ?? "") >= String(prev.time ?? "")) latest.set(id, l);
  }
  if (latest.size === 0) return events;
  return events.map((e) => {
    const l = latest.get(String(e?.trace_id ?? ""));
    if (!l) return e;
    return { ...e, label: String(l.label), label_at: l.label_at ?? l.time ?? null };
  });
}

/**
 * 后验标签口径（**单一实现** · 0.33.1 R-gm-33-1-02）。
 *
 * 输入只有三个事实：本次验收结论、本任务此前是否被打回过、验收人是否声明「结论推翻了建议」。
 * 四档的语义与先后（**顺序即优先级**，别改）：
 *
 *   1. `rejected`  —— 本次验收不通过。当下结论最硬，压过一切历史。
 *   2. `overridden` —— 通过，但验收人声明业务最终走了别的路。对 provider 而言这是「判断未被采纳」，
 *      虽然活儿干成了也得记成负例；**只有人能声明**（系统无法从账上可靠推断「建议 vs 实做」）。
 *   3. `rework`    —— 通过，但此前被打回过。说明原建议不足以一次过，算负例。
 *   4. `accepted`  —— 通过且一次过。唯一正例（= `POSITIVE_LABEL`）。
 *
 * 为什么不把「通过 + 曾被打回」也算正例：那会把「第一次判断错了」洗成正确，
 *   校准曲线会系统性偏乐观，而这正是阈值建议最容易骗人的地方。
 *
 * @param {{verdict?: string|null, rejectedBefore?: boolean, overridden?: boolean}} p
 * @returns {string} `LABELS` 之一
 */
export function labelOf({ verdict = null, rejectedBefore = false, overridden = false } = {}) {
  if (String(verdict ?? "") !== "pass") return "rejected";
  if (overridden === true) return "overridden";
  if (rejectedBefore === true) return "rework";
  return "accepted";
}

/**
 * 阈值状态的人读表达（读面共用**单一实现**：CLI `gd decision show` 与工位台页面都用它）。
 *
 * 为什么读面要专门回答这一句：阈值只对 `mode=auto` 有意义，而 P0/P1 阶段所有 provider 都
 *   `calibrated: false` ⇒ 即便达了阈值也**不许**自动动作。读面若只说「置信度 0.92」会让人以为
 *   系统已经采纳了；必须把「未标定 ⇒ 只提示不动作」说出来。
 *
 * `calibrated: null` = **观测行里没有这个事实**（`decisions.jsonl` 不记标定态）：此时不许猜「已标定」，
 *   一律按「未知 ⇒ 不动作」表述。要拿到确定值请调用方从注册表查（`decisionProviderOf(provider)`）。
 *
 * @param {{mode?:string|null, threshold?:number|null, confidence?:number, calibrated?:boolean|null,
 *          fallback_used?:boolean, fallback_reason?:string|null, fallback_to?:string|null}} p
 * @returns {string}
 */
export function thresholdStateOf({ mode = null, threshold = null, confidence = 0, calibrated = false, threshold_active = null, fallback_used = false, fallback_reason = null, fallback_to = null } = {}) {
  // 降级态优先：发生降级时「这条建议算不算数」的答案已经确定，比阈值比较更重要
  if (fallback_used && fallback_reason === "provider_error") return `已降级：provider 异常 ⇒ 规则兜底（${fallback_to ?? "兜底"}），结果仅参考`;
  if (fallback_used && fallback_reason === "low_confidence") return `低置信 ⇒ 该转 ${fallback_to ?? "人工"}（未采纳，结果未被改写）`;
  if (mode !== "auto") return mode === "shadow" ? "旁路记录（不改业务返回）" : "仅建议（mode=assist，永不自动动作）";
  if (threshold === null || threshold === undefined) return "auto 但无阈值 ⇒ 不自动采纳";
  if (calibrated === null || calibrated === undefined) return `只提示不动作（阈值 ${threshold} · 观测行未记标定态，按未标定处理）`;
  if (!calibrated) return `未达可采信条件（阈值 ${threshold} · provider 未标定 ⇒ 只提示不动作）`;
  // 0.34.1：阈值还有第二道门——必须绑到该 provider 的某一份校准记录（版本相符才算数）
  if (threshold_active === false) return `阈值未生效（阈值 ${threshold} · 未绑定校准 / 校准记录缺失或版本不符 ⇒ 只提示不动作）`;
  return confidence >= threshold ? `达阈值（${confidence} ≥ ${threshold}）` : `未达阈值（${confidence} < ${threshold}）`;
}

/**
 * 决策观测读面（工位台 / 工作站共用）：最近 N 条，最新在前。
 *
 * 只读、不做任何派生判断——`threshold_state` 也是格式化，不是新口径（单一实现在 `thresholdStateOf`）。
 *
 * @param {string} boardRoot 板根（席位模式下 = 项目库根）
 * @param {{limit?: number}} [o]
 * @returns {{available:boolean, count:number, total:number, items:object[]}}
 */
export function decisionFeed(boardRoot, { limit = 3 } = {}) {
  const all = readDecisionEvents(boardRoot);
  const rows = all.slice(-Math.max(1, limit)).reverse();
  return {
    available: rows.length > 0,
    count: rows.length,
    total: all.length,
    items: rows.map((e) => ({
      trace_id: e.trace_id ?? null,
      time: e.time ?? null,
      kind: e.kind ?? null,
      provider: e.provider ?? null,
      choice: e.choice ?? null,
      confidence: typeof e.confidence === "number" ? e.confidence : 0,
      mode: e.mode ?? null,
      threshold: e.threshold ?? null,
      accepted: e.accepted === true,
      // 0.34.1：观测行自己记了标定态与阈值是否生效 ⇒ 读面直接用，不再「不知道就按未标定处理」
      calibrated: e.calibrated ?? null,
      calibration_id: e.calibration_id ?? null,
      threshold_active: e.threshold_active ?? null,
      threshold_state: thresholdStateOf({
        mode: e.mode,
        threshold: e.threshold ?? null,
        confidence: typeof e.confidence === "number" ? e.confidence : 0,
        calibrated: e.calibrated ?? null,
        threshold_active: e.threshold_active ?? null,
        fallback_used: e.fallback_used === true,
        fallback_reason: e.fallback_reason ?? null,
        fallback_to: e.fallback_to ?? null,
      }),
      basis: e.basis ?? "",
      error: e.error ?? null,
      shadow_agree: e.shadow_agree ?? null,
      fallback_used: e.fallback_used === true,
      fallback_to: e.fallback_to ?? null,
      fallback_reason: e.fallback_reason ?? null,
    })),
  };
}

/** 当天已用到的最大序号（从 trace_id 末段取） */
function lastSeqOfDay(boardRoot, dateKey) {
  let max = 0;
  for (const e of readDecisionEvents(boardRoot)) {
    const m = String(e.trace_id ?? "").match(/-(\d{8})-(\d{4})$/);
    if (m && m[1] === dateKey) max = Math.max(max, Number(m[2]) || 0);
  }
  return max;
}

/**
 * trace 信封 → decisions.jsonl 单行（扁平化；字段见 decision.schema.json 的 DecisionEvent）。
 * @param {object} trace service.decide 造的信封
 * @param {{time?: string}} [opts]
 */
export function toDecisionEvent(trace, { time = nowIso() } = {}) {
  const o = trace?.outcome ?? null;
  return {
    time,
    trace_id: trace?.trace_id ?? null,
    kind: trace?.kind ?? null,
    provider: trace?.provider ?? null,
    mode: trace?.mode ?? null,
    subject: redactDecisionContext(trace?.subject ?? {}),
    options_count: Number(trace?.options_count ?? 0),
    // 0.35.1：候选 id 落盘（审计要看「还考虑过什么」）。只存 id，不存候选内容；
    //   长度按 MAX_STRING 截断——id 本该是短标识，但「本该」不是保证，落盘侧兜一层底
    options: Array.isArray(trace?.options) ? trace.options.map((x) => String(x).slice(0, MAX_STRING)) : null,
    choice: o ? o.choice : null,
    confidence: o ? o.confidence : 0,
    threshold: trace?.threshold ?? null,
    accepted: Boolean(trace?.accepted),
    // 0.34.1：标定态与阈值绑定态必须进观测行——否则读面只能按「未标定」猜
    //   （0.33 的 thresholdStateOf 就吃了这个亏：calibrated 恒传 null）
    calibrated: trace?.calibrated === true,
    calibration_id: trace?.calibration_id ?? null,
    threshold_active: trace?.threshold_active === undefined ? null : trace?.threshold_active,
    latency_ms: Number(trace?.latency_ms ?? 0),
    input_hash: trace?.input_hash ?? null,
    basis: o ? String(o.basis ?? "") : "",
    // B-gm-000014：失败码必须进观测行。0.32 加降级/旁路字段时漏了它，后果是
    //   `eval` 的 errors 恒 0、`show` 的错误行永不显示、`eval` 的失败分桶拿不到数据，
    //   而且 0.34.1-04 想按 `E_UNREGISTERED_KIND` 剔空壳行也无从识别。
    error: trace?.error ?? null,
    label: trace?.label ?? null,
    label_at: trace?.label_at ?? null,
    // 0.32.1：旁路一致率与降级事实——观测面要能直接聚合，不必回头解析 trace 对象
    shadow_agree: trace?.shadow?.agree ?? null,
    fallback_used: trace?.fallback_used === true,
    fallback_to: trace?.fallback_to ?? null,
    fallback_reason: trace?.fallback_reason ?? null,
  };
}

/**
 * 追加一条决策事件（**须**在板锁内由本函数自己取锁；与其它写账同一条锁）。
 * 若 trace 尚未带 trace_id / input_hash，这里补（需要传 decisionCase 才能算指纹）。
 *
 * 观测写入**不打板快照**（`snapshot: false`）：一次派单已经有一版账快照，再为旁证数据多打一版，
 *   会让 `gd core snap --log` 被「决策观测」刷屏，还多付 3 个 git 子进程（派单是热路径）。
 *   数据不会丢——下一次任何账写入的 `git add -A` 会把它一起收进那一版快照。
 * @param {string} boardRoot
 * @param {object} trace service 造的信封（会被就地补字段，便于调用方拿到 trace_id）
 * @param {{decisionCase?: object, boardId?: string, time?: string}} [opts]
 * @returns {object} 落盘的那一行
 */
export function appendDecisionEvent(boardRoot, trace, { decisionCase = null, boardId = null, time = null } = {}) {
  const root = String(boardRoot);
  const id = boardId ?? readBoardConfig(root)?.id ?? "board";
  return withBoardLock(root, () => {
    const stamp = time ?? nowIso();
    const dateKey = dateKeyOf(new Date(stamp));
    if (!trace.trace_id) trace.trace_id = traceIdOf(id, dateKey, lastSeqOfDay(root, dateKey) + 1);
    if (!trace.input_hash && decisionCase) trace.input_hash = hashDecisionInput(decisionCase);
    const event = toDecisionEvent(trace, { time: stamp });
    const p = join(root, DECISIONS_FILE);
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify(event) + "\n", "utf8");
    return event;
  }, { label: "决策观测", snapshot: false });
}

/**
 * 追加一条后验标签（**须**在板锁内由本函数自己取锁；与其它写账同一条锁）。
 *
 * 两道闸门都在写前：
 *   · 标签必须是 `LABELS` 之一 —— 拼错一个字母就落一条永远进不了指标的废数据；
 *   · `trace_id` 必须在 `decisions.jsonl` 里真实存在 —— 否则就是一条**孤儿标签**：
 *     它永远合并不上任何调用行，却会让「已回填 N 条」这种统计看着很健康。宁可当场拒。
 *
 * 返回 `{ok:false}` 而不是抛错：调用方（验收流程）**不能因为标签写失败就否决验收**——
 *   决策层是旁证，不是判据（设计 §10.3「验收硬闸门不动」）。但调用方**必须把失败说出来**，
 *   不许静默吞掉（吞掉的后果 = 数据集缺行而无人知晓）。
 *
 * @param {string} boardRoot
 * @param {{traceId: string, label: string, task?: string|null, req?: string|null,
 *          verdict?: string|null, by?: string|null, time?: string|null}} p
 * @returns {{ok:true, row:object} | {ok:false, code:string, error:string}}
 */
export function appendDecisionLabel(boardRoot, { traceId, label, task = null, req = null, verdict = null, by = null, time = null } = {}) {
  const root = String(boardRoot);
  const id = String(traceId ?? "").trim();
  const lb = String(label ?? "").trim();
  if (!id) return { ok: false, code: "E_BAD_TRACE", error: "缺少 trace_id" };
  if (!LABELS.includes(lb)) return { ok: false, code: "E_BAD_LABEL", error: `标签非法："${lb}"（可用：${LABELS.join(" / ")}）` };
  const exists = readDecisionEvents(root, { labels: false }).some((e) => String(e?.trace_id ?? "") === id);
  if (!exists) return { ok: false, code: "E_TRACE_NOT_FOUND", error: `decisions.jsonl 里没有 trace_id "${id}"——不落孤儿标签` };
  return withBoardLock(root, () => {
    const stamp = time ?? nowIso();
    const row = {
      time: stamp,
      trace_id: id,
      label: lb,
      label_at: stamp,
      task: task ? String(task) : null,
      req: req ? String(req) : null,
      verdict: verdict ? String(verdict) : null,
      by: by ? String(by) : null,
    };
    const p = join(root, LABELS_FILE);
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify(row) + "\n", "utf8");
    return { ok: true, row };
  }, { label: "决策标签", snapshot: false });
}

/**
 * 观测写入开关（B-gm-000011）：`GD_DECISION_SINK=0` ⇒ 生产路径**不落观测**。
 *
 * 为什么需要这个开关（而不是"永远落盘"）：
 *   · 用户可能只要决策建议、不想让板里多出观测文件（观测是旁证，不是业务事实）；
 *   · 跑测时最怕测试往真实板里灌假观测——`GD_DECISION_SINK=0` 比"每个 e2e 各自记得换 cwd"可靠。
 * 只关**生产接线**（`traceSinkFor`）；`appendDecisionEvent` 直调（e2e 造数据）不受影响。
 */
export function decisionSinkEnabled(env = process.env) {
  return String(env?.GD_DECISION_SINK ?? "") !== "0";
}

/**
 * 造一个给 `service.decide({ traceSink })` 用的 sink。
 * 为什么闭包带 decisionCase：service 的 trace 信封里**不放** case（契约只有四字段 + 观测元信息），
 *   而输入指纹必须由 case 算 ⇒ 由调用方把 case 闭进来，service 不必 import 本模块。
 * @param {string} boardRoot
 * @param {object} decisionCase
 * @param {{boardId?: string, time?: string}} [opts]
 */
export function traceSinkFor(boardRoot, decisionCase, opts = {}) {
  // 关掉时给一个空 sink：trace 照旧产出（trace_id 不生成，因为 id 只在落盘时分配），业务零感知
  if (!decisionSinkEnabled()) return () => {};
  return (trace) => appendDecisionEvent(boardRoot, trace, { ...opts, decisionCase });
}

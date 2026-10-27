/**
 * 板账写面基元（board ledger）—— **core 层**（0.23.0 R-gm-046-02）
 *
 * 这里只放**纯写账**：写任务账 / 事件 / 派生态刷新 / 建需求骨架。**不碰 git、不碰注册表、不碰席位**——
 *   提交（合批 `gd sync`）与宿主概念留在 app 层 `boardops.mjs`（它把本模块原样再导出，调用方不用改）。
 *
 * 为什么分家：`@inkwill/gd-core` 私有分发件的静态闭包只收 core 层文件（闭包由 `core-closure.mjs` 现算 +
 *   `scripts/core-closure-check.mjs` 机检）。`boardops.mjs` 为了合批提交要 import `git.mjs`（→ 注册表），
 *   于是「登账三族」（`req new` / `task add` / `milestone add`）过去只能长在完整 CLI 里。
 *   写账基元搬进本文件后，core 自己就能登账，且**判据/形态只有一份**（app 侧复用同一份实现）。
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml } from "./yaml.mjs";
import { taskIdOf, writeIndexYaml } from "./reqflow.mjs";
import { affectsText } from "./defects.mjs";
import { devReqIdOf, prefixOfKind, v2ReqIdOf } from "./reqid.mjs";
import { appendDecisionLabel, labelOf, readDecisionEvents, DECISIONS_FILE } from "./decision-trace.mjs"; // 0.33.1 R-gm-33-1：后验标签回填（口径单一实现在 labelOf）
import { artifactCollisions, collideError, dedupeArtifacts } from "./artifact-conflict.mjs"; // 0.70.5 R-gm-70-5 T-02/T-03：同名件冲突 + 重复交件判重
import * as B from "./board.mjs";

/** 任务账 schema 未迁移时的统一拦截文案 */
const MIGRATE_HINT = "先迁移旧账：gd migrate --apply --yes";

/**
 * 任务归属 id（单一口径，与 `board.mjs` 归一化一致）：v5 账取 `executor`；存量未迁移账取 `agent` 别名。
 * 空串 = 未派（仍在 ready 队列）。
 */
export function taskOwnerId(task) {
  return String(task?.executor ?? task?.agent ?? "").trim();
}

/**
 * 条目是否已失效。**必须容字符串**：`parseYaml` 不转标量类型，账里写 `superseded: true`，
 * 读回是字符串 `"true"`——用 `!== true` 判断会把旧条目当有效件，验收复算拿旧指纹比对必误报。
 * @param {object|null} a 交付件条目
 * @returns {boolean}
 */
export function isSupersededArtifact(a) {
  const v = a?.superseded;
  return v === true || v === "true" || v === 1 || v === "1";
}

/**
 * 交付件合并（B-gm-000004 修复 · 0.31 前）：**同路径新条目顶掉旧的，但旧条目不删**。
 *
 * 修的是什么：原来一律 `[...旧, ...新]` 追加，同一文件被后续任务改动、或本任务重交件后，
 *   账上会同时躺着两条指纹，验收复算时不知道哪条算数（实测：T-gm-30-0-01 的 schema 被
 *   T-gm-30-0-02 改过，旧指纹永远对不上，靠人肉判断）。
 *
 * 现在的口径：
 *   · 同路径的旧条目置 `superseded: true` + `superseded_at`（**不删**——审计要看改动史）；
 *   · 新条目照常追加在末尾，天然是「当前真相」（读侧取非 superseded 的最后一条）；
 *   · 同一次交件里重复给同一路径 ⇒ 后给的赢（不产生两条并列）。
 *
 * @param {object[]|null} prev 账上已有条目
 * @param {object[]} incoming 本次交件条目（已算好 checksum）
 * @returns {object[]} 合并后的完整列表
 */
export function mergeArtifacts(prev, incoming) {
  return mergeArtifactsDetailed(prev, incoming).list;
}

/**
 * 合并交付件，**并把判重结果带回来**（0.70.5 · R-gm-70-5 T-03）。
 *
 * 判重口径在 `lib/artifact-conflict.mjs: dedupeArtifacts`（同一路径 + 同一指纹 ⇒ 不重复入账）。
 * 为什么不让 `mergeArtifacts` 自己判：调用方（`board-actions.handoffOnBoard`）要能在回执里说
 * 「判重跳过 N 件」——**静默去重等于让人以为交了 5 件、实际只进 3 件**。
 *
 * `mergeArtifacts` 保留为薄包装（返回数组），老调用方一个字都不用改。
 *
 * @param {object[]|null} prev 账上已有条目
 * @param {object[]} incoming 本次交件条目（已算好 checksum）
 * @returns {{list:object[], kept:object[], deduped:{path:string, checksum:string, at:string|null}[]}}
 */
export function mergeArtifactsDetailed(prev, incoming) {
  const prevList = (prev ?? []).filter((a) => a && a.path).map((a) => ({ ...a }));
  const { keep, deduped } = dedupeArtifacts({ artifacts: prevList }, incoming ?? []);
  const list = prevList;
  // 本次交件内同路径去重（后给赢）
  const latest = new Map();
  for (const a of keep) if (a?.path) latest.set(String(a.path), a);
  if (latest.size === 0) return { list, kept: [], deduped };
  const stamp = B.nowIso();
  for (const old of list) {
    if (latest.has(String(old.path)) && !isSupersededArtifact(old)) {
      old.superseded = true;
      old.superseded_at = stamp;
    }
  }
  return { list: [...list, ...latest.values()], kept: [...latest.values()], deduped };
}

/**
 * 当前有效交付件——验收复算与读面共用这一份口径。
 * 同路径取**最后一条**：新账由 `mergeArtifacts` 标 superseded 后天然只剩一条；但历史账里
 * 可能躺着「同路径多条、都没标 superseded」的老条目（B-gm-000004 之前的追加语义留下的），
 * 按最后一条算才不至于拿旧指纹误报。
 * @param {object|null} task 任务条目
 * @returns {object[]} 有效交付件（每路径至多一条）
 */
export function currentArtifactsOf(task) {
  const live = (task?.artifacts ?? []).filter((a) => a && a.path && !isSupersededArtifact(a));
  const last = new Map();
  for (const a of live) last.set(String(a.path), a); // 后写赢
  return [...last.values()];
}

/**
 * 决策 trace 关联合并（0.33.1）：**按 id 去重，先到先得**。
 *
 * 为什么不做「同 id 顶掉旧的」：trace 关联的语义是「这条活依据了哪条建议」，
 *   同一个 trace 重复交件不产生新事实，重复登记只会让账变吵。
 *   反过来，一条 trace 若已挂在**别的**任务上，那是真的冲突（标签会互相覆盖），
 *   由调用方（`handoffOnBoard`）在写前拒绝，而不是在这里静默去重。
 *
 * @param {object[]|null} prev
 * @param {{id: string, at?: string, by?: string}[]|null} incoming
 * @returns {object[]}
 */
export function mergeTraces(prev, incoming) {
  const list = (prev ?? []).filter((t) => t && t.id).map((t) => ({ ...t }));
  const seen = new Set(list.map((t) => String(t.id)));
  for (const t of incoming ?? []) {
    const id = String(t?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    list.push({ id, ...(t.at ? { at: String(t.at) } : {}), ...(t.by ? { by: String(t.by) } : {}) });
  }
  return list;
}

/**
 * 决策 trace 关联的两道闸门（0.33.1）——**写前**判，不落任何东西。
 *
 *   1. trace 必须在 `decisions.jsonl` 里真实存在。抄错一个字符的后果不是「报错」而是
 *      「落了一条永远合并不上的孤儿关联」：交件看着成功，验收时标签写不进去，而且没人会发现。
 *   2. 一条 trace 只能挂一个任务。挂两个的话，两次验收会往同一条调用行上写标签，
 *      后验收的覆盖先验收的——数据集静默错乱，比缺数据更坏。
 *
 * 判据放这里（而不是各写面各写一份）：板 CLI / core CLI / 席位 CLI 三条交件路径共用同一套判断，
 *   否则「哪条路更宽松」就会变成事实上的后门。
 *
 * @param {{projDir: string, reqId: string, taskId: string, traceIds: string[]}} p
 * @returns {{ok: true} | {ok: false, error: string, hint: string[]}}
 */
export function checkTraceAttach({ projDir, reqId, taskId, traceIds = [] }) {
  const ids = (traceIds ?? []).map((x) => String(x ?? "").trim()).filter(Boolean);
  if (ids.length === 0) return { ok: true };
  const known = new Set(readDecisionEvents(projDir, { labels: false }).map((e) => String(e?.trace_id ?? "")));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `决策 trace 不存在：${missing.join(" / ")}`,
      hint: [
        `已查 ${join(String(projDir), DECISIONS_FILE)}（本板共 ${known.size} 条观测）`,
        "抄错号会落一条永远合并不上的孤儿关联，所以这里直接拒；查号：gd decision show <trace_id> · gd decision eval",
      ],
    };
  }
  const taken = [];
  for (const t of B.readTaskLedger(projDir, reqId)?.tasks ?? []) {
    if (String(t?.id ?? "") === String(taskId)) continue;
    for (const tr of t?.traces ?? []) {
      if (tr?.id && ids.includes(String(tr.id))) taken.push({ id: String(tr.id), task: String(t.id) });
    }
  }
  if (taken.length > 0) {
    return {
      ok: false,
      error: `决策 trace 已挂在别的任务上：${taken.map((x) => `${x.id} → ${x.task}`).join(" / ")}`,
      hint: [
        "一条 trace 只能关联一个任务（否则两次验收会互相覆盖同一条调用行的后验标签）",
        "若这条建议确实同时影响了多个任务：只登记到最能代表其结论的那个任务，其余任务不登记",
      ],
    };
  }
  return { ok: true };
}

/**
 * 后验标签回填（0.33.1 R-gm-33-1-01）：把本次验收结论写成标签，落到 `labels.jsonl`。
 *
 * 三条边界：
 *   · **只对账上登记过 trace 的任务动手**——没登记就是没关联，不猜「大概哪条决策影响了这次验收」；
 *   · **不抛错**：返回 `{labels, error}`，验收流程照旧（决策层是旁证，不是判据）；
 *   · **不静默**：`error` 非空时调用方必须回显——数据集缺行而无人知晓，比缺行本身更坏。
 *
 * @param {{projDir: string, reqId: string, taskId: string, task: object, review: object, priorEvents: object[]}} p
 * @returns {{labels: object[], error: string|null}}
 */
export function backfillLabels({ projDir, reqId, taskId, task, review, priorEvents = [] }) {
  const traces = (task?.traces ?? []).filter((t) => t && t.id);
  if (traces.length === 0) return { labels: [], error: null };
  if (!review?.verdict) return { labels: [], error: null };
  // 「此前被打回过」= 事件流里已有本任务的 reject 结论（任务账只留最后一次 review，历史在事件流里）
  const rejectedBefore = priorEvents.some((e) => e?.kind === "review" && String(e?.task ?? "") === String(taskId) && String(e?.verdict ?? "") === "reject");
  const label = labelOf({ verdict: review.verdict, rejectedBefore, overridden: review.decision_overridden === true });
  const written = [];
  for (const t of traces) {
    const r = appendDecisionLabel(projDir, { traceId: String(t.id), label, task: taskId, req: reqId, verdict: review.verdict, by: review.by ?? null, time: review.at ?? null });
    if (!r.ok) return { labels: written, error: `${t.id}：${r.error}（${r.code}）` };
    written.push(r.row);
  }
  return { labels: written, error: null };
}

/**
 * 账内流转 + 事件落账（同一把锁内原子；含需求派生态刷新）。
 * @param {object} o
 * @param {string} o.projDir
 * @param {string} o.reqId
 * @param {string} o.taskId
 * @param {string|null} [o.to] 目标状态（null = 只落事件不改状态）
 * @param {object|null} [o.event] 事件（board 事件字段；task 由本函数补）
 * @param {object[]} [o.extraEvents] 需与主事件同批落账的附加事件（如 deliver）
 * @param {object|null} [o.review] 验收结论（写入任务账 review 段）
 * @param {string|null} [o.executor] 执行方（写入任务账 executor 段；派单指定谁做主）
 * @param {boolean} [o.clearExecutor] 显式把 executor 置空（撤派；与 `--to null` 同义）
 * @param {object[]|null} [o.artifacts] 追加交付件（写入 artifacts 段）
 * @param {object[]|null} [o.traces] 追加决策 trace 关联（写入 traces 段；0.33.1）
 * @param {boolean} [o.allowSame] 允许「同态重放」（如重复派单）
 * @param {string|null} [o.expectedRev] 客户端读到的账本版本（乐观锁；不符即 E_CONFLICT）
 * @returns {{from: string, to: string, task: object, events: object[], derived: object[], labels: object[], label_error: string|null}}
 */
export function applyTransition({ projDir, reqId, taskId, to = null, event = null, extraEvents = [], review = null, executor = null, clearExecutor = false, clearClaim = false, artifacts = null, traces = null, deliver = null, allowSame = false, expectedRev = null }) {
  return B.withBoardLock(projDir, () => {
    const ledger = B.readTaskLedger(projDir, reqId);
    B.assertRevision(ledger.path, ledger.revision, expectedRev);
    if (ledger.missing) throw new Error(`任务账不存在：reqs/${reqId}/task-list.yaml`);
    if (ledger.schemaVersion !== B.BOARD_SCHEMA_VERSION) {
      throw new Error(`任务账 schema v${ledger.schemaVersion} 未迁移（本命令只写 v${B.BOARD_SCHEMA_VERSION} 账）。${MIGRATE_HINT}`);
    }
    const task = ledger.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`任务 ${taskId} 不在 ${reqId} 账内`);
    const from = task.status;
    if (to && to !== from) {
      if (!B.canTransition(from, to)) {
        const allowed = (B.TASK_TRANSITIONS[from] ?? []).join(" / ") || "终态，不可再流转";
        throw new Error(`非法流转：${taskId} ${from} → ${to}（允许：${allowed}）`);
      }
      // 不变量：**进终态 done 必须当场带一条通过结论**（不认账上的旧结论）。
      //   验收归需求归属席位（只走 `gd seat task accept`；owner 侧 `gd check` 0.16.8 起已收权）；
      //   否则「done 但无验收结论」的条目会绕开闸门造出来，并骗过 `deriveTaskState`。
      if (to === "done" && review?.verdict !== "pass") {
        throw new Error(`进 done 必须带验收通过结论：${taskId} ${from} → done，须走 gd check <任务id> --pass（不写结论的旁路已堵）`);
      }
      task.status = to;
    } else if (to && to === from && !allowSame) {
      throw new Error(`任务 ${taskId} 已是 ${to}（如需重放请显式带 --again）`);
    }
    if (review) task.review = review;
    if (executor) task.executor = String(executor);
    // 「未派」= executor 空：in_progress 回退待办 / 显式撤派均清空目标（不是仅改状态字面）
    else if (clearExecutor || (from === "in_progress" && task.status === "ready")) task.executor = "";
    // 收尾即放占用（0.21.6）：交付进 review / 验收进 done 时**清掉 claim**——
    //   否则 `claim` 会永久留在账上，`gd work list` 里一堆"已完成却仍显示被占用"的噪声。
    if (clearClaim || task.status === "done" || (task.status === "review" && to === "review")) delete task.claim;
    // 0.70.5 R-gm-70-5 T-02：同名件冲突（判据在 `lib/artifact-conflict.mjs`，本处只负责「在锁内、写前」拦）——
    //   ① 判据要读「同需求全部任务账」，锁外读会在检查与写入之间留一个窗口
    //      （两个人同时交同名件，两份都通过检查，账上出现两条「已交」而盘上只有一份文件）；
    //   ② 这里是**全部写件面**的必经之路（`gd handoff` / 席位自报交付 / 注册项目账 handoff），
    //      判据落在这里三个面自动同一答案；落回某一个调用方 = 另外两个面没有闸门。
    if (artifacts?.length) {
      const col = artifactCollisions({ reqTasks: ledger.tasks, selfTaskId: taskId, incoming: artifacts });
      if (!col.ok) throw collideError(col.conflicts, taskId);
    }
    // 0.70.5 R-gm-70-5 T-03：判重结果要带回给调用方（回执里必须说「判重跳过 N 件」）
    let artifactsDeduped = [];
    let artifactsKept = [];
    if (artifacts?.length) {
      const merged = mergeArtifactsDetailed(task.artifacts, artifacts);
      task.artifacts = merged.list;
      artifactsDeduped = merged.deduped;
      artifactsKept = merged.kept;
    }
    if (traces?.length) task.traces = mergeTraces(task.traces, traces);
    // 0.33.1：回填标签前要读**既有**事件（判断此前是否被打回过），必须赶在本次 review 事件落账之前
    const priorEvents = review ? B.readEvents(projDir, reqId) : [];
    B.writeTaskLedger(projDir, reqId, { req: ledger.req, tasks: ledger.tasks }, { expectedRev: ledger.revision });
    // 0.70.5：`deliver` 事件**只能由这一层生成**——「本次真正进了几件」只有这里知道（判重刚发生）。
    //   让调用方拼事件 = 它只能数 `incoming`，判重时必然多报（审计面比账面更不能含糊）。
    const deliverEvents =
      deliver && artifacts?.length
        ? [
            {
              actor: String(deliver.actor ?? event?.actor ?? ""),
              kind: "deliver",
              state: artifactsKept.length ? `${artifactsKept.length} 件` : "0 件（全部判重）",
              artifacts: artifactsKept.map((a) => ({ path: a.path, checksum: a.checksum })),
              ...(artifactsDeduped.length ? { deduped: artifactsDeduped.length } : {}),
              ...(deliver.text ? { text: deliver.text } : {}),
            },
          ]
        : [];
    const batch = [...(event ? [event] : []), ...deliverEvents, ...extraEvents];
    const events = batch.length ? B.appendEvents(projDir, reqId, batch.map((e) => ({ ...e, task: taskId }))) : [];
    // 0.33.1：验收结论 → 后验标签（只对账上登记过 trace 的任务动手；失败不拦验收，但要回显）
    const lb = review?.verdict ? backfillLabels({ projDir, reqId, taskId, task, review, priorEvents }) : { labels: [], error: null };
    const derived = B.refreshReqStatuses(projDir, { reqIds: [reqId] });
    return { from, to: task.status, task, events, derived, labels: lb.labels, label_error: lb.error, artifacts_deduped: artifactsDeduped };
  });
}

/**
 * 追加任务（建需求后的拆分动作）：账内追加 + 需求派生态刷新，同一把锁内完成。
 * 任务初始态 = `ready`（待办）；目标给了就带 executor（已派待接手），留空 = 未派。只写 v5 账（旧账先 `gd migrate`）。
 * @param {object[]} tasks `{ id, title, executor, created?, input? }`
 * @param {{expectedRev?: string|null}} [opts] 客户端读到的账本版本（乐观锁）
 * @returns {{added: object[], ledger: object}}
 */
export function addTasks(projDir, reqId, tasks, { expectedRev = null } = {}) {
  return B.withBoardLock(projDir, () => {
    const ledger = B.readTaskLedger(projDir, reqId);
    B.assertRevision(ledger.path, ledger.revision, expectedRev);
    if (ledger.missing) throw new Error(`需求 ${reqId} 无任务账（reqs/${reqId}/task-list.yaml）`);
    if (ledger.schemaVersion !== B.BOARD_SCHEMA_VERSION) {
      throw new Error(`任务账 schema v${ledger.schemaVersion} 未迁移（本命令只写 v${B.BOARD_SCHEMA_VERSION} 账）。${MIGRATE_HINT}`);
    }
    const dup = tasks.map((t) => t.id).filter((id) => ledger.tasks.some((x) => x.id === id));
    if (dup.length > 0) throw new Error(`任务 id 已存在：${dup.join(" / ")}`);
    const added = tasks.map((t) => ({ status: "ready", executor: "", ...t }));
    ledger.tasks.push(...added);
    B.writeTaskLedger(projDir, reqId, { req: ledger.req, tasks: ledger.tasks }, { expectedRev: ledger.revision });
    B.refreshReqStatuses(projDir, { reqIds: [reqId] });
    return { added, ledger: B.readTaskLedger(projDir, reqId) };
  });
}

/**
 * 建需求（日常 4 步之①；CLI `gd req new` 与工位网页共用）：建任务账 v5 骨架 + 写 index.yaml 需求条目。
 * 只落盘不提交——提交由调用方决定（CLI 交给 `gd sync`，网页由服务收尾提交）。
 * @param {{projDir: string, pid: string, title: string, summary?: string, tasks?: {title: string, executor?: string, input?: string}[], subver?: string|null, defect?: object|null, v2?: {versionSeg: string|number, subverNo: string|number}|null}} o
 *   `v2`：新口径 id（`R-<板>-<版本段>-<子版号>`）——给了它就**不碰** `next_req_no`（全局序号只服务存量形态）。
 *   `bugDigits`：缺陷号位宽（3 = 存量，6 = 新口径板）；序号始终接 `next_bug_no`，不重置。
 * @returns {{reqId: string, created: string, tasks: object[]}}
 */
export function createRequirement({ projDir, pid, title, summary = "", tasks = [], subver = null, defect = null, v2 = null, dev = null, needs = [], bugDigits = 3 }) {
  const reqsDir = join(projDir, "reqs");
  const idxPath = join(reqsDir, "index.yaml");
  return B.withBoardLock(projDir, () => {
    let idx = { next_req_no: 1, requirements: [] };
    if (existsSync(idxPath)) {
      try {
        idx = parseYaml(readFileSync(idxPath, "utf8")) || idx;
      } catch {
        throw new Error(`index.yaml 解析失败（${idxPath}），请手工检查`);
      }
    } else {
      mkdirSync(reqsDir, { recursive: true });
    }
    const existing = Array.isArray(idx.requirements) ? idx.requirements : [];
    // 0.23.0 R-gm-061：前缀按 kind 分家（bug → B，其余 → R），序号各自独立计数
    const prefix = prefixOfKind(defect?.kind);
    // 0.28.3 R-gm-091：新口径 id 由「版本段 + 子版号」直接构成，不走全局序号；
    //   全局序号只服务存量形态，所以这条路径**不动** next_req_no（两种编号空间互不占号）。
    const useV2 = Boolean(v2) && prefix === "R";
    // 两轴模型的新形态（开发线段 + 线内序号）——与 v2 一样不借全局序号
    const useDev = Boolean(dev) && prefix === "R" && !useV2;
    const seq = useV2 || useDev ? null : nextSeqOf(idx, existing, prefix);
    // 0.23.0 R-gm-061：缺陷独立计数器；0.28.3 R-gm-091：新口径板上升为 6 位（`B-<板>-000004`），
    //   序号**接着 next_bug_no** 往下数（不重置）——与存量 3 位号不撞，识别按位数分形态。
    const bugWidth = prefix === "B" && Number(bugDigits) >= 6 ? 6 : 3;
    const reqId = useV2
      ? v2ReqIdOf(pid, v2.versionSeg, v2.subverNo)
      : useDev
        ? devReqIdOf(pid, dev.lineSeg, dev.seq)
        : prefix === "B"
        ? `B-${pid}-${String(seq).padStart(bugWidth, "0")}`
        : `${prefix}-${pid}-${String(seq).padStart(3, "0")}`;
    if (existing.some((r) => r?.id === reqId)) throw new Error(`需求 ${reqId} 已存在（index.yaml 序号未对齐），请手工检查后重试`);

    const created = new Date().toISOString().slice(0, 10);
    const entries = (tasks ?? [])
      .map((t, i) => ({
        id: taskIdOf(pid, reqId, i + 1),
        title: String(t?.title ?? "").trim(),
        executor: String(t?.executor ?? "").trim(),
        status: "ready",
        created,
        input: String(t?.input ?? ""),
      }))
      .filter((t) => t.title);

    mkdirSync(join(reqsDir, reqId), { recursive: true });
    B.writeTaskLedger(projDir, reqId, { req: reqId, tasks: entries });
    idx.requirements = [
      ...existing,
      {
        id: reqId,
        title,
        status: "ready", // 派生缓存：由任务账任务态派生（refreshReqStatuses）
        initiator: "用户",
        created,
        revision: 1,
        task_count: entries.length,
        task_done: 0,
        ...(subver ? { subver: String(subver).trim() } : {}),
        // m-7 0.70.0：需求能力诉求（裸专业能力 id 数组；**空数组不落盘**——与「没声明」同义）
        ...((Array.isArray(needs) ? needs : []).filter(Boolean).length > 0 ? { needs: (Array.isArray(needs) ? needs : []).filter(Boolean) } : {}), // 子版号 x.y.z（0.21.x：与需求 1:1，可多需求共享）
        // 0.21.14 缺陷口径（空值不落盘：feature 不写 kind，保持存量零 diff）
        ...(defect && defect.kind && defect.kind !== "feature" ? { kind: String(defect.kind) } : {}),
        ...(defect?.severity ? { severity: String(defect.severity) } : {}),
        ...(defect?.found_in ? { found_in: String(defect.found_in) } : {}),
        ...(defect?.affects?.length ? { affects: affectsText(defect.affects) } : {}),
        // 0.66：缺陷挂点（能力/判据/场景）——只对缺陷有意义，非缺陷不落盘
        ...(defect?.capability_ref ? { capability_ref: String(defect.capability_ref) } : {}),
        summary: String(summary ?? "").trim(),
        analysis: "（待讨论产出）",
      },
    ];
    if (useV2 || useDev) {
      if (existing.some((r) => r?.id === reqId)) throw new Error(`需求 ${reqId} 已存在（线内自增与账上不一致），请手工检查后重试`);
    } else if (prefix === "B") idx.next_bug_no = seq + 1;
    else idx.next_req_no = seq + 1;
    writeIndexYaml(idxPath, idx);
    return { reqId, created, tasks: entries };
  });
}

/**
 * 一组 id 尾段数字的最大值（无数字 ⇒ 0）——需求号（R/B）与任务号共用一份取尾判据。
 * @param {Array<string|number>} ids
 */
function maxTailNo(ids) {
  return ids.reduce((max, id) => {
    const n = Number(String(id ?? "").match(/-(\d+)$/)?.[1] ?? 0);
    return n > max ? n : max;
  }, 0);
}

/**
 * 下一个需求序号（0.23.0 R-gm-061）：R 与 B 各自独立计数（next_req_no / next_bug_no）。
 * 兜底：计数器缺失或落后于账内既有 id 时，取账内同前缀最大序号 + 1（老板首次落 B 的场景）。
 * @param {object} idx index.yaml 文档
 * @param {object[]} existing 账内既有需求条目
 * @param {"R"|"B"} prefix 编号前缀
 */
function nextSeqOf(idx, existing, prefix) {
  const counter = Number(prefix === "B" ? idx.next_bug_no : idx.next_req_no) || 1;
  const maxUsed = maxTailNo(existing.map((r) => r?.id).filter((id) => String(id ?? "").startsWith(`${prefix}-`)));
  return Math.max(counter, maxUsed + 1);
}

/** 需求内下一个任务序号（2 位；按账内既有任务 id 尾段最大序号 + 1） */
export function nextTaskNoOf(projDir, reqId) {
  const ledger = B.readTaskLedger(projDir, reqId);
  return maxTailNo(ledger.tasks.map((t) => t.id)) + 1;
}

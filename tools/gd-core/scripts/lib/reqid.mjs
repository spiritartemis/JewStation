/**
 * 需求 / 缺陷 / 任务 id 口径（**唯一实现**）
 *
 * **两种形态并存**（0.28.0 R-gm-088 起双轨）：存量 ~90 条需求与全部任务 id 一个字不动，
 *   新形态自 m-3（0.30 起）生效。判别只看**段数与位数**，两种形态天然不撞。
 *
 * ── 存量形态（legacy · 全局 3 位序号）─────────────────────────
 *   feature / chore → `R-<板id>-<3 位>`   序号取 index.yaml `next_req_no`
 *   bug             → `B-<板id>-<3 位>`   序号取 index.yaml `next_bug_no`（**独立计数**）
 *   任务            → `T-<板id>-<需求段>-NN`（R 段 = 3 位，B 段 = `B`+3 位）
 *
 * ── 新形态（v2 · 0.28 规则统一后自 0.30 起）────────────────────
 *   需求 ≡ 子版 1:1，id 自带版本坐标：
 *   feature / chore → `R-<板id>-<版本段>-<子版号>`   例 `R-gm-30-0`（≡ 子版 0.30.0）
 *   bug             → `B-<板id>-<6 位>`              例 `B-gm-000004`（id 不带版本段，
 *                                                      版本归属看 index 的 `subver` 字段）
 *   任务            → `T-<板id>-<需求段>-NN`          例 `T-gm-30-0-01` / `T-gm-B000004-01`
 *
 * **版本段只编 minor**：`0.30` → `30`，`0.31` → `31`；子版号从 `0` 起、**多位不补零**
 *   （`R-gm-30-10` ≡ 子版 `0.30.10`）。限定语：本编码只在 **0.x 主版本期**成立；
 *   主版本进位到 `1.x` 时需另定口径（届时 `1.0` 与 `0.10` 会撞成同一段），不预先猜。
 *
 * **序号位宽**：新形态不再有 3 位天花板（子版号多位、缺陷 6 位）；任务号 `01` 起、超 99 自然进三位。
 *
 * 内部规则不变：仍是一条需求 + `reqs/<id>/task-list.yaml` + 4 态机 + 结版门禁；
 *   前缀只决定编号空间，形态只决定 id 长什么样，不新增实体、不改派单 / 验收语义。
 */

// ── 形态片段（供其它正则内嵌复用）────────────────────────────

/** 旧需求 id 体（**无锚点**；3 位全局序号。提交首行 H1 等复用） */
export const REQ_ID_SRC = "[RB]-[a-z0-9]+-\\d{3}";

/** 新需求 id 体（**无锚点**）：R 带版本段-子版号；B 为 6 位序号 */
export const REQ_ID_V2_SRC = "[RB]-[a-z0-9]+-(?:\\d+-\\d+|\\d{6})";

/**
 * 开发形态需求 id 体（**无锚点**）：`R-<板id>-<开发线段>-<线内序号>`，如 `R-gm-1a-0`。
 *
 * 开发线段 = 里程碑（开发线）id 去 `m-` 前缀，形态 **数字 + 线别字母**（`1a` / `7b`）——
 * 带字母是它与 v2 版本段（纯数字 `30`）的**唯一区分**，两种形态天然不撞。
 */
export const REQ_ID_DEV_SRC = "R-[a-z0-9]+-\\d+[a-z]-\\d+";

/** 三种形态的合集（无锚点）——「是个需求 id」的通用判据 */
export const REQ_ID_ANY_SRC = `(?:${REQ_ID_V2_SRC}|${REQ_ID_DEV_SRC}|${REQ_ID_SRC})`;

/**
 * POSIX ERE 方言的「任意形态需求 id 体」——**给 shell 用**（commit-msg hook 的 `grep -E`）。
 *
 * grep -E 不认 `(?:` 与 `\d`，所以这里从 `REQ_ID_ANY_SRC` **派生**（不是另抄一份）：
 * 只做两处等价替换 ⇒ 形态一变两边同时变，不存在「改了 JS 忘了改 shell」的漂移
 * （B-gm-000031 就是这条：hook 里硬编码 legacy 三段，v2 号一律被拒）。
 * 由 `scripts/reqs/git-commit-e2e.mjs` 交叉校验（同一批 id 两种方言判定必须一致）。
 */
export const REQ_ID_POSIX_SRC = REQ_ID_ANY_SRC.replace(/\(\?:/g, "(").replace(/\\d/g, "[0-9]");

/** 旧需求 id 严格形态（3 位序号；提交 scope / 账内 legacy id 用） */
export const REQ_ID_RE = new RegExp(`^${REQ_ID_SRC}$`);

/** 新需求 id 严格形态 */
export const REQ_ID_V2_RE = new RegExp(`^${REQ_ID_V2_SRC}$`);

/** 开发形态需求 id 严格形态 */
export const REQ_ID_DEV_RE = new RegExp(`^${REQ_ID_DEV_SRC}$`);

/** 需求 id 任意形态（严格） */
export const REQ_ID_ANY_RE = new RegExp(`^${REQ_ID_ANY_SRC}$`);

/**
 * 需求目录名形态（宽松：兼容历史上多位序号，用于扫描 `reqs/`）。
 * 覆盖 legacy（`R-gm-001`）与 v2（`R-gm-30-0` / `B-gm-000004`）。
 */
export const REQ_DIR_RE = /^[RB]-[a-z0-9]+-(?:\d+-\d+|\d+[a-z]-\d+|\d+)$/;

/**
 * 任务 id 形态：`T-<板id>-<需求段>-NN`，需求段三选一：
 *   legacy R 段（3 位）· legacy B 段（`B`+3 位）· v2 段（`<版本段>-<子版号>` 或 `B`+6 位）
 * 任务号至少 2 位（超 99 自然进三位）。
 */
export const TASK_ID_RE = /^T-[a-z0-9]+-(?:B\d{6}|\d+[a-z]-\d+|\d+-\d+|B?\d{3})-\d{2,}$/;

/**
 * 需求能力诉求 `needs` 的条目形态（m-7 0.70.0）：裸 kebab-case 专业能力 id。
 *
 * **与能力条目 id 同形、不同命名空间**：能力条目 id（`gd cap new --id`）是本仓能力板账的分类键；
 * `needs` 的值是 producer 专业能力的诉求词（`design` / `doc-write` / `numeric`）。
 * 两者共用一份形态判据，但**不共用账**——这正是「两种能力不要混」的结构表达。
 *
 * 为什么单独立在这里而不是就近写在 `board-plans.mjs`：**写面自造 id 正则 = 下一个缺陷**
 * （B-gm-000028 同族）。id 形态的单一事实源是本文件。
 */
export const NEED_ID_SRC = "[a-z][a-z0-9-]*";
export const NEED_ID_RE = new RegExp(`^${NEED_ID_SRC}$`);

/** kind → id 前缀（feature / chore 共用 R；只有缺陷独占 B） */
const PREFIX_BY_KIND = { feature: "R", chore: "R", bug: "B" };

// ── 前缀 / kind ───────────────────────────────────────────────

/**
 * kind 对应的 id 前缀。
 * @param {string} [kind] 需求类型（缺省 / 未知一律 R）
 * @returns {"R"|"B"}
 */
export function prefixOfKind(kind) {
  return PREFIX_BY_KIND[String(kind ?? "").trim()] ?? "R";
}

/** id 前缀（首字母）；非需求 id 形态返回 "" */
export function prefixOfId(id) {
  const m = String(id ?? "").match(/^([RB])-/);
  return m ? m[1] : "";
}

/**
 * 由 id 前缀推断 kind（**只给读侧兜底**；权威仍是 index 的 `kind` 字段——
 * 存量缺陷住 R 号，光看前缀会误判为 feature）。
 * @returns {"bug"|"feature"}
 */
export function kindOfId(id) {
  return prefixOfId(id) === "B" ? "bug" : "feature";
}

// ── 形态判别（双轨核心）────────────────────────────────────────

/**
 * 需求 id 的形态。
 * @param {string} id
 * @returns {"legacy"|"v2"|"dev"|""} 空串 = 不是需求 id
 *   · legacy：3 位全局序号（`R-gm-001` / `B-gm-003`）
 *   · v2：带版本坐标（`R-gm-30-0`）或缺陷 6 位（`B-gm-000004`）
 *   · dev：带开发线段（`R-gm-1a-0`）——两轴模型的新形态，需求坐标是**开发线**不是版本
 */
export function reqFormOf(id) {
  const s = String(id ?? "");
  if (REQ_ID_DEV_RE.test(s)) return "dev";
  if (REQ_ID_V2_RE.test(s)) return "v2";
  if (REQ_ID_RE.test(s)) return "legacy";
  return "";
}

/** 是否需求 id（任意形态，严格） */
export function isReqId(v) {
  return REQ_ID_ANY_RE.test(String(v ?? ""));
}

/** 是否**新形态**需求 id */
export function isReqIdV2(v) {
  return REQ_ID_V2_RE.test(String(v ?? ""));
}

/** 是否**存量形态**需求 id */
export function isReqIdLegacy(v) {
  return REQ_ID_RE.test(String(v ?? ""));
}

/** 是否**开发形态**需求 id（两轴模型新形态：`R-gm-1a-0`） */
export function isReqIdDev(v) {
  return REQ_ID_DEV_RE.test(String(v ?? ""));
}

/** 是否需求目录名（宽松形态；扫 reqs/ 时用） */
export function isReqDir(v) {
  return REQ_DIR_RE.test(String(v ?? ""));
}

/** 是否任务 id */
export function isTaskId(v) {
  return TASK_ID_RE.test(String(v ?? ""));
}

// ── 段位解析 ─────────────────────────────────────────────────

/** 需求序号（id 尾段数字）：`R-gm-061` → "061" · `B-gm-001` → "001" · `R-gm-30-0` → "0"；无匹配返回 "" */
export function reqSeqOf(reqId) {
  const m = String(reqId ?? "").match(/-(\d+)$/);
  return m ? m[1] : "";
}

/**
 * 新形态需求的**版本段**（minor 数字）：`R-gm-30-0` → "30"。
 * 缺陷（`B-…`）与 legacy 形态返回 ""（它们不带版本段；版本归属看 index 的 `subver`）。
 */
export function versionSegOf(reqId) {
  const s = String(reqId ?? "");
  if (reqFormOf(s) !== "v2" || prefixOfId(s) !== "R") return "";
  const m = s.match(/^R-[a-z0-9]+-(\d+)-\d+$/);
  return m ? m[1] : "";
}

/**
 * 新形态需求的**子版号**：`R-gm-30-0` → "0" · `R-gm-30-10` → "10"。
 * 缺陷与 legacy 形态返回 ""。
 */
export function subverNoOf(reqId) {
  const s = String(reqId ?? "");
  if (reqFormOf(s) !== "v2" || prefixOfId(s) !== "R") return "";
  const m = s.match(/^R-[a-z0-9]+-\d+-(\d+)$/);
  return m ? m[1] : "";
}

/**
 * 新形态需求 id → 子版号别名（`x.y.z`）：`R-gm-30-0` → `0.30.0`。
 *
 * **限定语**：版本段只编 minor，故别名恒为 `0.<版本段>.<子版号>`——只在 0.x 主版本期成立。
 * 非 v2 需求（缺陷 / 存量）返回 ""（它们的子版号不在 id 里）。
 * @param {string} reqId
 * @returns {string}
 */
export function subverAliasOf(reqId) {
  const seg = versionSegOf(reqId);
  const no = subverNoOf(reqId);
  if (seg === "" || no === "") return "";
  return `0.${seg}.${no}`;
}

/**
 * 开发形态需求的**开发线段**：`R-gm-1a-0` → "1a"。
 * 非开发形态（legacy / v2 / 缺陷）返回 ""。
 * （里程碑侧同名的 `devLineSegOf` 取的是**卡** ⇒ 线段；这里是**需求 id** ⇒ 线段，别混。）
 */
export function devLineSegOfId(reqId) {
  const s = String(reqId ?? "");
  if (reqFormOf(s) !== "dev") return "";
  const m = s.match(/^R-[a-z0-9]+-(\d+[a-z])-\d+$/);
  return m ? m[1] : "";
}

/**
 * 任务 id 内的「需求段」：
 *   legacy R → 3 位序号（`061`）· legacy B → `B`+3 位（`B001`）
 *   v2 R     → `<版本段>-<子版号>`（`30-0`）· v2 B → `B`+6 位（`B000004`）
 * @param {string} reqId 需求 id
 */
export function idSegOf(reqId) {
  const prefix = prefixOfId(reqId);
  if (reqFormOf(reqId) === "dev") {
    const seg = devLineSegOfId(reqId);
    const no = reqSeqOf(reqId);
    return seg && no !== "" ? `${seg}-${no}` : "";
  }
  if (reqFormOf(reqId) === "v2") {
    if (prefix === "B") {
      const seq = reqSeqOf(reqId);
      return seq ? `B${seq}` : "";
    }
    const seg = versionSegOf(reqId);
    const no = subverNoOf(reqId);
    return seg && no !== "" ? `${seg}-${no}` : "";
  }
  const seq = reqSeqOf(reqId);
  if (!seq) return "";
  return prefix === "B" ? `B${seq}` : seq;
}

/**
 * 任务 id 派生：`T-<板id>-<需求段>-<NN>`
 *   legacy：R-gm-061 第 1 个任务 → T-gm-061-01 · B-gm-001 → T-gm-B001-01
 *   v2：    R-gm-30-0 第 1 个 → T-gm-30-0-01 · B-gm-000004 → T-gm-B000004-01
 * @param {string} pid 板 / 项目 id（如 gm）
 * @param {string} reqId 需求 id
 * @param {number} taskNo 需求内任务序号（1 起；2 位补零，超 99 自然进三位）
 */
export function taskIdOf(pid, reqId, taskNo) {
  return `T-${pid}-${idSegOf(reqId)}-${String(taskNo).padStart(2, "0")}`;
}

/**
 * 任务 id → 需求段（`taskIdOf` 的逆运算之一）：`T-gm-30-0-01` → `30-0` · `T-gm-088-01` → `088`。
 * 非任务 id 返回 ""。
 */
export function taskSegOf(taskId) {
  const s = String(taskId ?? "");
  const m = s.match(/^T-[a-z0-9]+-(.+?)-\d{2,}$/);
  return m ? m[1] : "";
}

// ── 构造器（新形态）────────────────────────────────────────────

/**
 * 新形态需求 id：`R-<板id>-<版本段>-<子版号>`。
 * @param {string} pid 板 id
 * @param {string|number} versionSeg 版本段（minor 数字，如 30）
 * @param {string|number} subverNo 子版号（0 起）
 */
export function v2ReqIdOf(pid, versionSeg, subverNo) {
  return `R-${pid}-${String(versionSeg)}-${String(subverNo)}`;
}

/**
 * 开发形态需求 id：`R-<板id>-<开发线段>-<线内序号>`（两轴模型的新形态）。
 * @param {string} pid 板 id
 * @param {string|number} lineSeg 开发线段（数字 + 线别字母，如 `1a`）
 * @param {string|number} seq 线内序号（0 起）
 */
export function devReqIdOf(pid, lineSeg, seq) {
  return `R-${pid}-${String(lineSeg)}-${String(seq)}`;
}

/**
 * 新形态缺陷 id：`B-<板id>-<6 位>`。
 * @param {string} pid 板 id
 * @param {number} seq 缺陷序号（1 起，补零到 6 位）
 */
export function v2BugIdOf(pid, seq) {
  return `B-${pid}-${String(seq).padStart(6, "0")}`;
}

/**
 * id 是否属于某个编号命名空间（板 id 或项目 id）：`R-<ns>-…` / `B-<ns>-…` / `T-<ns>-…`。
 * @param {string} ns 板 id 或项目 id
 * @param {string} id 需求 id 或任务 id
 */
export function idInNamespace(ns, id) {
  if (!ns || !id) return false;
  const s = String(id);
  return s.startsWith(`R-${ns}-`) || s.startsWith(`B-${ns}-`) || s.startsWith(`T-${ns}-`);
}

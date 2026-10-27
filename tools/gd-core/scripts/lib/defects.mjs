/**
 * 缺陷口径（**唯一实现** · 0.21.14）
 *
 * 设计决定（用户拍板）：**缺陷不另立实体**——bug 就是一条需求，用 `kind: bug` 标记，
 *   靠四个可选字段承载缺陷语义；**id 前缀独立**（0.23.0 R-gm-061）：bug 自动得
 *   `B-<板id>-NNN`（序号 `next_bug_no` 独算，与 R 号互不占号），任务 `T-<板id>-BNNN-NN`；
 *   内部仍是同一套 index / 任务账 / 4 态机 / 结版门禁。存量缺陷（`R-` + `kind: bug`）不迁移。
 *
 *   kind      feature（缺省，不落盘）| bug | chore
 *   severity  blocker | major | minor —— **bug 必填**（无严重级的缺陷等于没定级）
 *   found_in  发现于哪个版本（x.y 或 x.y.z）—— **bug 必填**（"发现于" ≠ "引入于"）
 *   affects   受影响版本，可多个（逗号分隔落盘）—— 判断"要不要 backport"的依据
 *
 * **`introduced_in`（引入版本）故意不做字段**：精确追溯要 bisect + 建 commit→子版映射，
 *   成本高于价值；需要时现场 `git log -S` / `blame` 查即可。
 *
 * 本模块同时承载**三档体量标准**的机读判据（`SIZE_TIERS`）：见 `entry/workflow/protocol.md` §3.7（`gd core guide` 的 0.6 节是 agent 版）。AI 自觉发现缺陷时
 *   按 `tierOf()` 分档，避免把顺手可修的小问题升级成新流程摩擦。
 */

/** 需求类型（缺省 = feature，**不落盘**以保持存量零 diff） */
export const REQ_KINDS = ["feature", "bug", "chore"];

/** 缺陷严重级（bug 必填） */
export const BUG_SEVERITIES = ["blocker", "major", "minor"];

/** 严重级中文标签（渲染用；键集须与 BUG_SEVERITIES 一致） */
export const SEVERITY_LABELS = { blocker: "阻塞", major: "严重", minor: "轻微" };

/** 子版 / 版本形态 */
const VER_RE = /^\d+\.\d+(\.\d+)?$/;

/** 需求条目 → 缺陷口径（缺省归一：无 kind 即 feature；affects 支持数组与逗号串两种落盘形态） */
export function defectOf(entry) {
  const raw = entry ?? {};
  const kind = String(raw.kind ?? "").trim() || "feature";
  const affectsRaw = raw.affects;
  const affects = (Array.isArray(affectsRaw) ? affectsRaw : String(affectsRaw ?? "").split(","))
    .map((v) => String(v ?? "").trim())
    .filter((v) => VER_RE.test(v));
  return {
    kind,
    severity: String(raw.severity ?? "").trim(),
    found_in: String(raw.found_in ?? "").trim(),
    affects,
  };
}

/** 是否缺陷 */
export function isBug(entry) {
  return defectOf(entry).kind === "bug";
}

/**
 * 字段校验：`req new` / `req update` 共用。
 * @returns {null | {error: string, hint: string}} null = 通过
 */
export function validateDefectFields({ kind, severity, found_in: foundIn, affects = [], capability_ref: capRef = "" } = {}) {
  const k = String(kind ?? "").trim() || "feature";
  const sev = String(severity ?? "").trim();
  const fi = String(foundIn ?? "").trim();
  if (!REQ_KINDS.includes(k)) return { error: `--kind 非法："${k}"`, hint: `可用：${REQ_KINDS.join(" / ")}（缺省 feature）` };
  if (k !== "bug") {
    if (sev) return { error: `只有缺陷（--kind bug）才带 --severity`, hint: "特性 / 杂务没有严重级；若这就是缺陷，改 --kind bug" };
    if (fi) return { error: `只有缺陷（--kind bug）才带 --found-in`, hint: "特性 / 杂务不记「发现于」" };
    // 0.66：能力挂点同理 —— 「违反了哪条判据」只有缺陷说得通
    if (String(capRef ?? "").trim()) {
      return { error: "只有缺陷（--kind bug）才带 --capability-ref", hint: "特性 / 杂务不挂能力判据；要说明本次为哪项能力演进用 --capability" };
    }
    return null;
  }
  // 缺陷：严重级与发现版本都必填
  if (!sev) return { error: "缺陷缺 --severity", hint: `可用：${BUG_SEVERITIES.join(" / ")}（blocker = 阻塞结版）` };
  if (!BUG_SEVERITIES.includes(sev)) return { error: `--severity 非法："${sev}"`, hint: `可用：${BUG_SEVERITIES.join(" / ")}` };
  if (!fi) return { error: "缺陷缺 --found-in", hint: "填发现时正在验的版本（x.y 或 x.y.z）——它≠引入版本，不需要 bisect" };
  if (!VER_RE.test(fi)) return { error: `--found-in 需 x.y 或 x.y.z 形态（现值：${fi}）`, hint: "例：--found-in 0.21.13" };
  for (const a of affects) {
    if (!VER_RE.test(String(a))) return { error: `--affects 含非法版本："${a}"`, hint: "逗号分隔，形如 --affects 0.21.12,0.21.13" };
  }
  // 0.66：能力挂点形态（存在性校验在写面另做一遍 —— 这里只管形态，管得了“像不像”管不了“在不在”）
  const ref = String(capRef ?? "").trim();
  if (ref) {
    const parts = ref.split("/");
    if (parts.length > 3) return { error: `--capability-ref 最多三段（能力/判据/场景）：收到 "${ref}"`, hint: "形如 --capability-ref req-intake/R1/S2" };
    if (parts[1] && !/^R[1-9][0-9]*$/.test(parts[1])) return { error: `--capability-ref 第二段应为判据号 R<n>："${parts[1]}"`, hint: "例：req-intake/R1" };
    if (parts[2] && !/^S[1-9][0-9]*$/.test(parts[2])) return { error: `--capability-ref 第三段应为场景号 S<n>："${parts[2]}"`, hint: "例：req-intake/R1/S2" };
    if (parts[2] && !parts[1]) return { error: "--capability-ref 给了场景却没给判据", hint: "三级要自左向右给：能力/R#/S#" };
  }
  return null;
}

/** 落盘形态：`affects` 以逗号串写入（行级序列化友好；读侧 `defectOf` 归一） */
export function affectsText(list) {
  return (Array.isArray(list) ? list : []).map((v) => String(v).trim()).filter(Boolean).join(",");
}

/**
 * 结版前的阻塞缺陷（0.21.14 门禁；0.49.6 F6 改归属判据）：某版本下 **未完成** 的 blocker 缺陷。
 *
 * 判据（单一事实 = `found_in`）：缺陷不再占子版号（`gd req new --kind bug` 不收 `--subver`），
 *   「它挡哪一条子版结版」改由 **发现处** 决定——`found_in` 落在同一条 `x.y` 线上，就挡这条线的任何子版结版。
 *   为什么按 `x.y` 而非精确 `x.y.z`：`found_in` 记的是「发现时正在验的版本」，通常早于你现在要结的子版；
 *   按子版精确匹配会让「0.70.0 发现的 blocker」只能挡 0.70.0，后面每一条都能结过去，门禁就形同虚设。
 * **兼容读**：存量缺陷账上还带着 `subver`（旧口径的版本归属），仍按它命中——否则历史 blocker 一夜之间失门。
 * 新写面不再产生这种字段；下次改到那条缺陷时顺手清掉即可。
 *
 * @param {object[]} reqs 需求索引条目
 * @param {string} version 版本 `x.y` 或子版 `x.y.z`（均按 `x.y` 线匹配）
 * @returns {Array<{id: string, title: string, status: string, found_in: string, subver: string}>}
 */
export function openBlockersOf(reqs, version) {
  const v = String(version ?? "").trim();
  if (!v) return [];
  const line = v.split(".").slice(0, 2).join("."); // x.y
  const inParams = (raw) => {
    const s = String(raw ?? "").trim();
    if (!s) return false;
    if (s === v || s === line) return true;
    return s.startsWith(`${line}.`);
  };
  const hitsVersion = (r) => inParams(r.found_in) || inParams(r.subver); // found_in 主判 · subver 存量兼容
  return (reqs ?? [])
    .filter(hitsVersion)
    .filter((r) => defectOf(r).kind === "bug" && defectOf(r).severity === "blocker")
    .filter((r) => String(r.status ?? "") !== "done")
    .map((r) => ({
      id: String(r.id),
      title: String(r.title ?? ""),
      status: String(r.status ?? ""),
      found_in: String(r.found_in ?? ""),
      subver: String(r.subver ?? ""),
    }));
}

/**
 * 三档体量标准（**机读判据**）——AI 发现缺陷时先分档，再决定要不要立单：
 *
 *   T0 顺手修      不动契约 / 账格式 / 状态机 / 门禁；≤ 3 文件 ≤ 30 行；无需新 e2e
 *                  ⇒ **不立单**，就地修 + 交付说明留一行「顺手修：…」
 *   T1 立缺陷单    跨模块 / 需要回归测试 / 影响已结版
 *                  ⇒ `gd req new --board --kind bug --severity <major|minor> --found-in <ver>`
 *   T2 阻塞级      阻塞结版（blocker）或影响已发布版本
 *                  ⇒ 立单 + severity blocker（结版门禁会拦）+ 立刻告知用户（backport 与否由人定）
 */
export const SIZE_TIERS = [
  {
    tier: "T0",
    label: "顺手修（不立单）",
    maxFiles: 3,
    maxLines: 30,
    forbidTouching: ["cli-contract", "账格式", "状态机", "门禁", "core 闭包"],
    rule: "就地修 + 交付说明留一行「顺手修：…」；不提需求、不建任务、不占版本号",
  },
  {
    tier: "T1",
    label: "立缺陷单（修在当前在途子版）",
    rule: "gd req new --board --kind bug --severity major|minor --found-in <ver> [--affects a,b]；归属当前子版，不写回已结版",
  },
  {
    tier: "T2",
    label: "阻塞 / 跨版",
    rule: "severity=blocker（结版门禁拦）；影响已发布版本时立刻告知用户，是否 backport 开子版由人定",
  },
];

/**
 * 分档（AI 自用判据；人也可读）。**唯一"要立单"的机读信号是触及禁区或超体积**。
 * @param {{files?: number, lines?: number, touchesContract?: boolean, needsRegression?: boolean, blocking?: boolean, affectsReleased?: boolean}} m
 */
export function tierOf({ files = 0, lines = 0, touchesContract = false, needsRegression = false, blocking = false, affectsReleased = false } = {}) {
  if (blocking || affectsReleased) return "T2";
  if (touchesContract || needsRegression || files > 3 || lines > 30) return "T1";
  return "T0";
}

/** 分档理由（渲染用：告诉人/AI 为什么是这一档） */
export function tierReason({ files = 0, lines = 0, touchesContract = false, needsRegression = false, blocking = false, affectsReleased = false } = {}) {
  if (blocking) return "标了 blocker（阻塞结版）";
  if (affectsReleased) return "影响已发布版本";
  if (touchesContract) return "触及契约 / 账格式 / 状态机 / 门禁";
  if (needsRegression) return "需要新回归测试";
  if (files > 3) return `改动 ${files} 个文件（>3）`;
  if (lines > 30) return `改动 ${lines} 行（>30）`;
  return `改动 ${files} 文件 / ${lines} 行，且不触禁区——顺手修完即可`;
}

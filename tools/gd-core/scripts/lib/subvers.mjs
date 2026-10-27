/**
 * 子版账（subversion ledger）—— **子版级结版**（0.21.4）
 *
 * 背景：排期是四层（里程碑 → 版本 `x.y` → 子版 `x.y.z` → 需求）。子版号挂在**需求**上（`subver`），
 *   所以"这条子版做得怎么样"是派生出来的；但**结版（reached）是宣告动作，不是派生状态**——
 *   里程碑同理：需求全验收只是事实，`reached` 要人拍（铁律，见 protocol §3.6）。
 *
 * 因此本模块只存**结版事实**（`<板根>/subvers.yaml`）：
 *   - 键 = 子版号 `x.y.z`；值 = `reached_on`（+ 可选 `note`）
 *   - 与 `reqs/index.yaml` 解耦（不动需求条目结构）、与里程碑账解耦（不塞进 milestones.yaml）
 *
 * 派生态（`roadmap-view` 消费）：
 *   - 子版 `done`   = 其名下需求全部验收通过
 *   - 子版 `closed` = 有 `reached_on` 记录（人已宣告结版）
 *   两者独立：`done && !closed` 显示「已完成 · 待结版」。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml, unquoteScalar } from "./yaml.mjs";

export const SUBVERS_FILE = "subvers.yaml";

const SUBVER_RE = /^\d+\.\d+\.\d+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 子版号形态（单一事实源：`x.y.z`） */
export function isSubver(v) {
  return SUBVER_RE.test(String(v ?? "").trim());
}

/** 账文件路径 */
export function subversPathOf(boardRoot) {
  return join(boardRoot, SUBVERS_FILE);
}

/**
 * 读子版账。
 * @returns {{ok: boolean, exists: boolean, path: string, list: Array<{alias: string, reached_on: string, note: string}>, error: string|null}}
 */
export function readSubvers(boardRoot) {
  const path = subversPathOf(boardRoot);
  if (!existsSync(path)) return { ok: true, exists: false, path, list: [], error: null };
  let doc;
  try {
    doc = parseYaml(readFileSync(path, "utf8")) ?? {};
  } catch (e) {
    return { ok: false, exists: true, path, list: [], error: `解析失败：${e?.message ?? e}` };
  }
  const raw = Array.isArray(doc.subvers) ? doc.subvers : [];
  const list = raw
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      alias: String(unquoteScalar(x.alias ?? "")).trim(),
      reached_on: String(unquoteScalar(x.reached_on ?? "")).trim(),
      note: String(unquoteScalar(x.note ?? "")).trim(),
    }))
    .filter((x) => x.alias);
  return { ok: true, exists: true, path, list, error: null };
}

/** 校验条目（形态 / 日期 / 重复）——供 CLI 写前闸门与契约检查共用 */
export function validateSubvers(list) {
  const errors = [];
  const seen = new Set();
  for (const s of list ?? []) {
    const alias = String(s?.alias ?? "").trim();
    if (!isSubver(alias)) errors.push({ code: "E_SV_ALIAS", alias, msg: `子版号形态非法：${alias || "（空）"}（应为 x.y.z）` });
    else if (seen.has(alias)) errors.push({ code: "E_SV_DUP", alias, msg: `子版号重复：${alias}` });
    else seen.add(alias);
    if (!DATE_RE.test(String(s?.reached_on ?? "").trim())) {
      errors.push({ code: "E_SV_DATE", alias, msg: `\`reached_on\` 必须是 YYYY-MM-DD（现值：${s?.reached_on ?? "空"}）` });
    }
  }
  return errors;
}

/** 序列化（字段顺序固定；条目按子版号数值排序，便于人读与 diff） */
export function serializeSubvers(list) {
  const sorted = [...(list ?? [])].sort((a, b) => String(a.alias).localeCompare(String(b.alias), "en", { numeric: true }));
  const lines = [
    "# 子版账（板级）——子版级结版事实：`gd ver reach <x.y.z>` 写入；子版完成度仍由需求状态派生",
    "# 口径见 entry/workflow/protocol.md §3.6（开版与结版纪律）· 设计见 docs/gd-core-session-workflow-design.md",
  ];
  if (sorted.length === 0) lines.push("subvers: []");
  else {
    lines.push("subvers:");
    for (const s of sorted) {
      lines.push(`  - alias: ${s.alias}`);
      lines.push(`    reached_on: ${s.reached_on}`);
      if (s.note) lines.push(`    note: ${/[:#]|^\s|\s$/.test(s.note) ? `"${s.note.replace(/"/g, "'")}"` : s.note}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** 写子版账（调用方负责持锁） */
export function writeSubvers(boardRoot, list) {
  const path = subversPathOf(boardRoot);
  writeFileSync(path, serializeSubvers(list), "utf8");
  return path;
}

/** 子版 → 结版记录（查用；未结版返回 null） */
export function closedOf(list) {
  const map = new Map();
  for (const s of list ?? []) map.set(s.alias, s);
  return (alias) => map.get(String(alias)) ?? null;
}

/**
 * 子版号比较（`x.y.z` **数字序**；缺段按 0 补）。
 *
 * 为什么要有它：版本号是**发布序列**（同一板上单调递增——版本线 `x.y` 内 `z` 递增，跨线亦然），
 *   所以「对外收口到哪一版」= **号最大的已结版子版**，而不是「结版日期最新的」。
 *   （0.21.7 初版按 `reached_on` 日期排 ⇒ 2026-10-22 结了 0.24.1 时，把登记值从 0.26.1 硬拽回 0.24.1，
 *   版本号凭空倒挂；注入的身份段也跟着写旧号。已改为号序，见 `latestClosedSubver`。）
 */
export function compareSubverAlias(a, b) {
  const pa = String(a ?? "").split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b ?? "").split(".").map((x) => Number.parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * 板上「最新已结版子版」= 总控版本登记的**唯一事实源**（0.21.7 · 0.24.2 R-gm-085 修排序）。
 *
 * 口径：**已结版**（`reached_on` 有合法日期）里**版本号最大**的那条。
 *   · 为何不是「最大 subver」：最大号可能只是在途版本（连需求都没验收）——故先按已结版过滤；
 *   · 为何不是「结版日期最新」：日期不是发布序列（今天补结一个旧线的小版本会让版本号倒挂），
 *     故主序取**版本号数字序**，`reached_on` 仅作同号 tiebreak（实际不会同号）。
 *   · 一条都没结版 ⇒ 返回 null（调用方决定退回到登记副本 / 需求里的最大 subver）。
 * @param {Array<{alias: string, reached_on: string}>} list `readSubvers()` 的 list
 * @returns {string|null}
 */
export function latestClosedSubver(list) {
  const rows = (list ?? []).filter((x) => x && isSubver(x.alias) && /^\d{4}-\d{2}-\d{2}$/.test(String(x.reached_on ?? "")));
  if (rows.length === 0) return null;
  rows.sort((a, b) => compareSubverAlias(b.alias, a.alias) || String(b.reached_on).localeCompare(String(a.reached_on)));
  return rows[0].alias;
}

/**
 * 板内下一个子版号（缺省策略，单一实现）：**在某条版本线（`x.y`）内**取 `z+1`。
 *   一个都没有 ⇒ null（不硬造号）。`req new` 与 `req apply` 共用，避免两处各写一套递增规则。
 *
 * **为什么必须限定在线内（0.21.15 · R-gm-038）**：原先取**全板最大** subver 再 +1，
 *   于是「在 0.21 线上干活的人」不写 `--subver` 就会拿到 `0.22.z` —— **挂到别人的版本线上**
 *   （实测：另一会话在 0.22.x 干活时，本会话漏写 `--subver` 就会被分到 0.22 的线上）。
 *   递增只在**确定的版本线内**发生，跨线必须显式点名。
 *
 * @param {Array<{subver?: string}>} reqEntries `readReqEntries()` 的结果
 * @param {{version?: string|null}} [opts] `version` = 目标版本线 `x.y`；缺省 = 全板最大（**仅当线上唯一**才可用）
 * @returns {string|null}
 */
export function nextSubver(reqEntries, { version = null } = {}) {
  const rows = (reqEntries ?? [])
    .map((r) => String(r?.subver ?? "").trim())
    .filter((v) => isSubver(v))
    .map((v) => v.split(".").map(Number));
  if (rows.length === 0) return null;
  if (version) {
    const [maj, min] = String(version).split(".").map(Number);
    if (!Number.isFinite(maj) || !Number.isFinite(min)) return null;
    const inLine = rows.filter((r) => r[0] === maj && r[1] === min);
    const maxZ = inLine.length ? Math.max(...inLine.map((r) => r[2])) : -1;
    return `${maj}.${min}.${maxZ + 1}`; // 该线上还没有 ⇒ 从 .0 起
  }
  const latest = rows.reduce((a, b) => (b[1] > a[1] || (b[1] === a[1] && b[2] >= a[2]) ? b : a));
  return `${latest[0]}.${latest[1]}.${latest[2] + 1}`;
}

/** 板内已用到的版本线（去重、升序）：`["0.21", "0.22"]` */
export function subverLines(reqEntries) {
  const set = new Set();
  for (const r of reqEntries ?? []) {
    const v = String(r?.subver ?? "").trim();
    if (!isSubver(v)) continue;
    set.add(v.split(".").slice(0, 2).join("."));
  }
  return [...set].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

/**
 * 下一个子版号的**完整决策**（单一实现 · 0.21.15 · R-gm-038）：显式 / 认领线内 / 唯一线内 / 拒绝跨线。
 *
 * 判据（自上而下）：
 *   ① 显式 `--subver x.y.z` ⇒ 校验形态后用；
 *   ② 本会话**认领的版本线**（`lanes` 里 owner = 当前身份）⇒ 在该线内 `z+1`（认领优先 ⇒ 多线并行不串号）；
 *   ③ 无认领但板上**只有一条线**在用 ⇒ 在那条线内 `z+1`；
 *   ④ 多条线在用且本会话无认领 ⇒ **拒绝自动分配**（跨线会把需求挂到别人的版本线上）；
 *   ⑤ 一条线都没有 ⇒ null（不硬造号）。
 *
 * @param {{reqEntries?: Array<{subver?: string}>, raw?: string|null, lanes?: Array<{version: string, owner: string}>, actor?: string|null}} o
 * @returns {{value: string|null, error?: string, hint?: string}}
 */
export function resolveNextSubver({ reqEntries = [], raw = null, lanes = [], actor = null } = {}) {
  const SUBVER_RE = /^\d+\.\d+\.\d+$/;
  if (typeof raw === "string" && raw.trim()) {
    const v = raw.trim();
    if (!SUBVER_RE.test(v)) return { value: null, error: `--subver 需 x.y.z 形态（现值：${v}）` };
    return { value: v };
  }
  const entries = Array.isArray(reqEntries) ? reqEntries : [];
  const lines = subverLines(entries);
  const mine = (Array.isArray(lanes) ? lanes : []).filter((l) => actor && l.owner === actor).map((l) => l.version);
  if (mine.length > 0) {
    const withEntries = mine.filter((v) => lines.includes(v));
    const line = (withEntries.length > 0 ? withEntries : mine).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).pop();
    return { value: nextSubver(entries, { version: line }) };
  }
  if (lines.length === 1) return { value: nextSubver(entries, { version: lines[0] }) };
  if (lines.length > 1) {
    return {
      value: null,
      error: `板上有 ${lines.length} 条版本线在用（${lines.join(" / ")}），本会话未认领任何一条——不能自动分配子版号（会挂到别人的线上）`,
      hint: `· 显式指定：--subver <x.y.z>
· 或先认领一条线：gd ver claim ${lines[lines.length - 1]} --as <名字>（再 export GD_EXECUTOR=<名字>）`,
    };
  }
  return { value: null };
}

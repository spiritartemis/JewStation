/**
 * 版本线账（version lanes）—— **谁负责哪条版本线**（0.21.5）
 *
 * 背景（**存量口径**：两轴模型后新板走 `lines.mjs` 的开发线认领，本账只读保留）。
 *   旧模型排期是四层（里程碑 → 版本 `x.y` → 子版 `x.y.z` → 需求）。多会话并行时，"谁在做 0.22、
 *   谁在做 0.23"必须有**数据事实**，否则两个会话可能同时改同一条版本线而互相踩。
 *
 * 落点：`<板根>/lanes.yaml`（板级小账，与 `reqs/index.yaml`、`milestones.yaml`、`subvers.yaml` 解耦）：
 *   lanes:
 *     - version: "0.22"      # 版本号 x.y
 *       owner: w2            # 负责人（会话自报的名，建议用板内名册 executors[] 里的名字）
 *       since: 2026-10-18
 *       note: ""
 *
 * 身份：会话用环境变量 `GD_EXECUTOR` 自报名字（缺省 = 板默认执行体 `local`）。
 *   由此所有写面闸门都能自动判定"这条线是不是我的"，不需要每个命令都加旗标。
 *
 * 语义（**软隔离**）：线有 owner ⇒ 他人写该线的需求/任务/结版时被拒（可 `--force` 越过并留痕）；
 *   线无 owner ⇒ 谁都能写（默认状态，向后兼容存量板）。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml, unquoteScalar } from "./yaml.mjs";
import { DEFAULT_EXECUTOR } from "./board-resolve.mjs";

export const LANES_FILE = "lanes.yaml";

const VERSION_RE = /^\d+\.\d+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 会话自报名（`GD_EXECUTOR`）→ 缺省板执行体 */
export function actorOf(env = process.env, board = null) {
  const fromEnv = String(env?.GD_EXECUTOR ?? "").trim();
  if (fromEnv) return fromEnv;
  const first = board?.executors?.[0]?.id;
  return first || DEFAULT_EXECUTOR;
}

/** 子版 `x.y.z` → 版本 `x.y`（若不是子版号则原样返回） */
export function versionOfSubver(subver) {
  const s = String(subver ?? "").trim();
  const m = /^(\d+\.\d+)\.\d+$/.exec(s);
  return m ? m[1] : s;
}

export function isVersion(v) {
  return VERSION_RE.test(String(v ?? "").trim());
}

export function lanesPathOf(boardRoot) {
  return join(boardRoot, LANES_FILE);
}

/** 读版本线账 */
export function readLanes(boardRoot) {
  const path = lanesPathOf(boardRoot);
  if (!existsSync(path)) return { ok: true, exists: false, path, list: [], error: null };
  let doc;
  try {
    doc = parseYaml(readFileSync(path, "utf8")) ?? {};
  } catch (e) {
    return { ok: false, exists: true, path, list: [], error: `解析失败：${e?.message ?? e}` };
  }
  const raw = Array.isArray(doc.lanes) ? doc.lanes : [];
  const list = raw
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      version: String(unquoteScalar(x.version ?? "")).trim(),
      owner: String(unquoteScalar(x.owner ?? "")).trim(),
      since: String(unquoteScalar(x.since ?? "")).trim(),
      note: String(unquoteScalar(x.note ?? "")).trim(),
    }))
    .filter((x) => x.version);
  return { ok: true, exists: true, path, list, error: null };
}

/** 校验（形态 / 日期 / 版本重复 / owner 非空） */
export function validateLanes(list) {
  const errors = [];
  const seen = new Set();
  for (const l of list ?? []) {
    const version = String(l?.version ?? "").trim();
    if (!isVersion(version)) errors.push({ code: "E_LN_VERSION", version, msg: `版本号形态非法：${version || "（空）"}（应为 x.y）` });
    else if (seen.has(version)) errors.push({ code: "E_LN_DUP", version, msg: `版本线重复：${version}` });
    else seen.add(version);
    if (!String(l?.owner ?? "").trim()) errors.push({ code: "E_LN_OWNER", version, msg: `缺 owner（谁负责这条线）` });
    if (l?.since && !DATE_RE.test(String(l.since).trim())) errors.push({ code: "E_LN_SINCE", version, msg: `\`since\` 需 YYYY-MM-DD（现值：${l.since}）` });
  }
  return errors;
}

/** 写版本线账（调用方负责持锁） */
export function writeLanes(boardRoot, list) {
  const path = lanesPathOf(boardRoot);
  const sorted = [...(list ?? [])].sort((a, b) => String(a.version).localeCompare(String(b.version), "en", { numeric: true }));
  const lines = [
    "# 版本线账（板级）——谁负责哪条版本线：`gd ver claim <x.y> --as <名字>` 写入",
    "# 口径见 entry/workflow/protocol.md §3.6 · 会话用 GD_EXECUTOR 自报身份",
  ];
  if (sorted.length === 0) lines.push("lanes: []");
  else {
    lines.push("lanes:");
    for (const l of sorted) {
      lines.push(`  - version: ${l.version}`);
      lines.push(`    owner: ${l.owner}`);
      if (l.since) lines.push(`    since: ${l.since}`);
      if (l.note) lines.push(`    note: ${/[:#]|^\s|\s$/.test(l.note) ? `"${l.note.replace(/"/g, "'")}"` : l.note}`);
    }
  }
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
  return path;
}

/**
 * 写面闸门：**这条版本线是不是我的**。
 * @param {string} boardRoot
 * @param {string} subverOrVersion 子版 `x.y.z` 或版本 `x.y`
 * @param {{actor: string, force?: boolean}} o
 * @returns {null | {error: string, hint: string}} null = 放行
 */
export function laneGate(boardRoot, subverOrVersion, { actor, force = false } = {}) {
  const version = versionOfSubver(subverOrVersion);
  if (!isVersion(version)) return null; // 没有版本号 ⇒ 无归属可判（如未编号需求）
  const lanes = readLanes(boardRoot);
  if (!lanes.ok || lanes.list.length === 0) return null; // 未声明归属 ⇒ 默认开放（向后兼容）
  const lane = lanes.list.find((l) => l.version === version);
  if (!lane || !lane.owner) return null;
  if (lane.owner === actor) return null;
  if (force) return null; // 调用方已显式 --force：越过并留痕（由调用方打印）
  return {
    error: `版本线 ${version} 归 ${lane.owner} 所有（自 ${lane.since || "—"}），当前身份是 ${actor}`,
    hint: [
      `改用该线负责人身份：export GD_EXECUTOR=${lane.owner}`,
      `或换一条线；确需越过加 --force（会留痕），或让负责人 gd ver release ${version}`,
    ].join(" · "),
  };
}

/**
 * 写面闸门的一站式入口（`laneGate` 的常用组合）：自带身份解析 + `--force` 语义。
 * 五个写面（req new / req apply / task add / task gen / work claim / ver reach）共用，
 * 免得每处都写 `laneGate(root, subver, { actor: actorOf(process.env, board), force: ... })`。
 * @returns {null | {error: string, hint: string}} null = 放行
 */
export function assertLane(boardRoot, subverOrVersion, { board = null, force = false, env = process.env } = {}) {
  return laneGate(boardRoot, subverOrVersion, { actor: actorOf(env, board), force });
}

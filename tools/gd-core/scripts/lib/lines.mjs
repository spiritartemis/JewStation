/**
 * 开发线账（dev lines）—— **谁负责哪条开发线**（两轴模型 · 开发轴）
 *
 * 背景：两轴模型里「版本线认领」随版本坐标一起搬去了发布轴；内部并行隔离改由**开发线**承担——
 *   多会话并行时，"谁在做 m-1a"必须有**数据事实**，否则两个会话同时改同一条线会互相踩。
 *   开发线 = 里程碑（开发线的载体），线号 = 里程碑 id 去 `m-` 前缀（如 `m-1a` ⇒ 线号 `1a`）。
 *
 * 落点：`<板根>/lines.yaml`（板级小账，与 `reqs/index.yaml` / `milestones.yaml` / `releases.yaml` 解耦）：
 *   lines:
 *     - line: "1a"          # 开发线号（里程碑 id 去 m- 前缀）
 *       owner: w2           # 负责人（会话自报的名）
 *       since: 2026-10-27
 *       note: ""
 *
 * 身份：会话用环境变量 `GD_EXECUTOR` 自报名字（缺省 = 板默认执行体 `local`）。
 * 语义（**软隔离**）：线有 owner ⇒ 他人写该线的需求/任务时被拒（可 `--force` 越过并留痕）；
 *   线无 owner ⇒ 谁都能写（默认状态，向后兼容存量板）。
 *
 * 存量兼容：老模型的**版本线**认领（`lanes.yaml`）只读保留 —— 那是旧模型的历史，不迁。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml, unquoteScalar } from "./yaml.mjs";
import { DEFAULT_EXECUTOR } from "./board-resolve.mjs";

export const LINES_FILE = "lines.yaml";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 开发线号形态：数字 + 可选线别字母（如 `1a` / `7`）——与版本号 `x.y` 天然不撞 */
export const DEV_LINE_RE = /^\d+[a-z]*$/;

/** 是否开发线号形态 */
export function isDevLine(line) {
  return DEV_LINE_RE.test(String(line ?? "").trim());
}

/** 会话自报名（`GD_EXECUTOR`）→ 缺省板执行体 */
export function actorOf(env = process.env, board = null) {
  const fromEnv = String(env?.GD_EXECUTOR ?? "").trim();
  if (fromEnv) return fromEnv;
  const first = board?.executors?.[0]?.id;
  return first || DEFAULT_EXECUTOR;
}

export function linesPathOf(boardRoot) {
  return join(boardRoot, LINES_FILE);
}

/** 读开发线账 */
export function readLines(boardRoot) {
  const path = linesPathOf(boardRoot);
  if (!existsSync(path)) return { ok: true, exists: false, path, list: [], error: null };
  let doc;
  try {
    doc = parseYaml(readFileSync(path, "utf8")) ?? {};
  } catch (e) {
    return { ok: false, exists: true, path, list: [], error: `解析失败：${e?.message ?? e}` };
  }
  const raw = Array.isArray(doc.lines) ? doc.lines : [];
  const list = raw
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      line: String(unquoteScalar(x.line ?? "")).trim(),
      owner: String(unquoteScalar(x.owner ?? "")).trim(),
      since: String(unquoteScalar(x.since ?? "")).trim(),
      note: String(unquoteScalar(x.note ?? "")).trim(),
    }))
    .filter((x) => x.line);
  return { ok: true, exists: true, path, list, error: null };
}

/** 校验（形态 / 日期 / 线重复 / owner 非空） */
export function validateLines(list) {
  const errors = [];
  const seen = new Set();
  for (const l of list ?? []) {
    const line = String(l?.line ?? "").trim();
    if (!isDevLine(line)) errors.push({ code: "E_DL_LINE", line, msg: `开发线号形态非法：${line || "（空）"}（应为数字 + 可选线别字母，如 1a）` });
    else if (seen.has(line)) errors.push({ code: "E_DL_DUP", line, msg: `开发线重复：${line}` });
    else seen.add(line);
    if (!String(l?.owner ?? "").trim()) errors.push({ code: "E_DL_OWNER", line, msg: "缺 owner（谁负责这条线）" });
    if (l?.since && !DATE_RE.test(String(l.since).trim())) errors.push({ code: "E_DL_SINCE", line, msg: `\`since\` 需 YYYY-MM-DD（现值：${l.since}）` });
  }
  return errors;
}

/** 写开发线账（调用方负责持锁） */
export function writeLines(boardRoot, list) {
  const path = linesPathOf(boardRoot);
  const sorted = [...(list ?? [])].sort((a, b) => String(a.line).localeCompare(String(b.line), "en", { numeric: true }));
  const lines = [
    "# 开发线账（板级）——谁负责哪条开发线：`gd line claim <线号> --as <名字>` 写入",
    "# 口径见 entry/workflow/protocol.md §3.6 · 会话用 GD_EXECUTOR 自报身份",
  ];
  if (sorted.length === 0) lines.push("lines: []");
  else {
    lines.push("lines:");
    for (const l of sorted) {
      lines.push(`  - line: ${l.line}`);
      lines.push(`    owner: ${l.owner}`);
      if (l.since) lines.push(`    since: ${l.since}`);
      if (l.note) lines.push(`    note: ${/[:#]|^\s|\s$/.test(l.note) ? `"${l.note.replace(/"/g, "'")}"` : l.note}`);
    }
  }
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
  return path;
}

/**
 * 写面闸门：**这条开发线是不是我的**。
 * @returns {null | {error: string, hint: string}} null = 放行
 */
export function lineGate(boardRoot, line, { actor, force = false } = {}) {
  const key = String(line ?? "").trim();
  if (!isDevLine(key)) return null; // 没有线号 ⇒ 无归属可判（如存量未编号需求）
  const lines = readLines(boardRoot);
  if (!lines.ok || lines.list.length === 0) return null; // 未声明归属 ⇒ 默认开放
  const rec = lines.list.find((l) => l.line === key);
  if (!rec || !rec.owner) return null;
  if (rec.owner === actor) return null;
  if (force) return null; // 调用方已显式 --force：越过并留痕
  return {
    error: `开发线 ${key} 归 ${rec.owner} 所有（自 ${rec.since || "—"}），当前身份是 ${actor}`,
    hint: [
      `改用该线负责人身份：export GD_EXECUTOR=${rec.owner}`,
      `或换一条线；确需越过加 --force（会留痕），或让负责人 gd line release ${key}`,
    ].join(" · "),
  };
}

/**
 * 写面闸门的一站式入口（自带身份解析 + `--force` 语义）。
 * @returns {null | {error: string, hint: string}} null = 放行
 */
export function assertLine(boardRoot, line, { board = null, force = false, env = process.env } = {}) {
  return lineGate(boardRoot, line, { actor: actorOf(env, board), force });
}

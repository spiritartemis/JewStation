/**
 * 开发线认领的**计划实现**（两轴模型 · 开发轴）—— `gd line claim|release|list`
 *
 * 与 `lib/board-vers.mjs` 的版本线认领同构、换了一根轴：
 *   版本线（`lanes.yaml`）= **旧模型**的并行隔离坐标（只读兼容，不迁）；
 *   开发线（`lines.yaml`）= **新模型**的并行隔离坐标（线段 = 里程碑 id 去 `m-` 前缀）。
 *
 * 语义（软隔离）：线有 owner ⇒ 他人写该线的需求/任务时被拒（`--force` 越过并留痕）；无 owner ⇒ 谁都能写。
 */
import { dateStrOf } from "./milestones.mjs";
import { withBoardLock } from "./board.mjs";
import { actorOf } from "./lanes.mjs";
import { readLines, validateLines, writeLines } from "./lines.mjs";
import { out } from "./style.mjs";

const ok = (lines, extra = {}) => ({ ok: true, lines, ...extra });
const bad = (lines) => ({ ok: false, code: 1, lines });
const asJson = (obj) => ({ ok: true, lines: [], json: obj });

/** 认领一条开发线（owner = 会话自报名；`--force` 越过既有归属） */
export function lineClaimPlan({ board, line, as = "", note = "", force = false, json = false, env = process.env }) {
  const key = String(line ?? "").trim();
  const who = String(as ?? "").trim() || actorOf(env, board);
  if (!key) return bad(["✗ 缺开发线号（gd line claim <线号> --as <名字>）"]);
  return withBoardLock(board.root, () => {
    const fresh = readLines(board.root);
    if (!fresh.ok) return bad([`✗ 开发线账读取失败：${fresh.error}`]);
    const prev = fresh.list.find((l) => l.line === key);
    if (prev && prev.owner !== who && !force) {
      return bad([
        `✗ 开发线 ${key} 已归 ${prev.owner} 所有（自 ${prev.since || "—"}）`,
        `  · 确需改归加 --force；或让 ${prev.owner} 先释放：gd line release ${key}`,
      ]);
    }
    const since = prev && prev.owner === who ? prev.since : dateStrOf();
    const next = [...fresh.list.filter((l) => l.line !== key), { line: key, owner: who, since, note: note || (prev?.note ?? "") }];
    const errs = validateLines(next);
    if (errs.length > 0) return bad([`✗ 写入校验未通过：${errs.map((e) => e.msg).join(" / ")}`]);
    writeLines(board.root, next);
    const forced = !!prev && prev.owner !== who;
    if (json) return asJson({ ok: true, board: board.id, line: key, owner: who, since, forced });
    return ok([
      out.ok(`✅ 开发线 ${key} 归 ${who}（自 ${since}）${forced ? `（原 ${prev.owner}，--force 越过）` : ""}`),
      out.dim(`  · 该线的需求 / 任务写面：他人需 GD_EXECUTOR=${who} 或 --force`),
    ]);
  });
}

/** 释放开发线（owner 本人或 `--force`；本无归属 ⇒ 幂等） */
export function lineReleasePlan({ board, line, as = "", force = false, json = false, env = process.env }) {
  const key = String(line ?? "").trim();
  const who = String(as ?? "").trim() || actorOf(env, board);
  return withBoardLock(board.root, () => {
    const fresh = readLines(board.root);
    if (!fresh.ok) return bad([`✗ 开发线账读取失败：${fresh.error}`]);
    const rec = fresh.list.find((l) => l.line === key);
    if (!rec) {
      if (json) return asJson({ ok: true, line: key, released: false, reason: "本无归属" });
      return ok([out.dim(`· 开发线 ${key} 本无归属，无需释放`)]);
    }
    if (rec.owner !== who && !force) return bad([`✗ 开发线 ${key} 归 ${rec.owner}，非本人释放需 --force（当前身份 ${who}）`]);
    writeLines(board.root, fresh.list.filter((l) => l.line !== key));
    if (json) return asJson({ ok: true, line: key, released: true });
    return ok([out.ok(`✅ 开发线 ${key} 已释放（原 ${rec.owner}）`)]);
  });
}

/** 开发线清单（只读） */
export function lineListPlan({ board, json = false }) {
  const fresh = readLines(board.root);
  if (!fresh.ok) return bad([`✗ 开发线账读取失败：${fresh.error}`]);
  const items = [...fresh.list].sort((a, b) => String(a.line).localeCompare(String(b.line), "en", { numeric: true }));
  if (json) return asJson({ ok: true, board: board.id, lines: items });
  if (items.length === 0) return ok([out.dim("（还没有开发线归属——gd line claim <线号> --as <名字>）")]);
  return ok([
    ...items.map((l) => `${out.ok("▸")} ${l.line}  ${l.owner}${l.since ? `（自 ${l.since}）` : ""}${l.note ? `  ${out.dim(l.note)}` : ""}`),
    out.dim(`共 ${items.length} 条开发线`),
  ]);
}

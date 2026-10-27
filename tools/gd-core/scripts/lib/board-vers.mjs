/**
 * board-vers —— 子版结版与版本线（**core 层** · 0.23.1 R-gm-048）
 *
 * 干什么：`gd ver list|reach|reopen|claim|release|lanes` 的**判据与回显**只有这一份——
 *   core 面（`gd-core ver …`，无注册表 / 无席位 / 无 git）与完整 CLI（`gd ver …`）共用它，
 *   回显逐字一致（同一组 lines），退出码由调用方按 `ok` 定。
 *
 * 为什么算 core：结版 / 版本线全是**板账自己的事**（`<板根>/subvers.yaml` / `lanes.yaml`），
 *   不依赖宿主（注册表 / 席位 / 工作站），也不写工作区文件。铁律闸门（`--confirm` 点名）随之下沉——否则
 *   core 分发出去的那套装了个 CLI 却没有结版能力，用户还是得靠完整 CLI。
 *
 * 口径（与 `entry/workflow/protocol.md` §3.6 / §3.7 一致）：
 *   · **完成度由需求派生**（需求全验收 ⇒ 已完成）；`reached_on` 是**人的宣告**，两者分开显示；
 *   · 结版须**点名确认**（`--confirm <x.y.z>`，逐字相等）+ 版本线归属 + 无未完成 blocker 缺陷；
 *   · 撤销结版（reopen）须点名确认 + **必须写理由**，语义是「之前的宣告有误」，不是「又发现 bug」。
 */
import { readReqEntries, withBoardLock } from "./board.mjs";
import { confirmHint, isConfirmed } from "./confirm.mjs";
import { openBlockersOf } from "./defects.mjs";
import { actorOf, assertLane, isVersion, readLanes, validateLanes, writeLanes } from "./lanes.mjs";
import { dateStrOf } from "./milestones.mjs";
import { out } from "./style.mjs";
import { closedOf, isSubver, readSubvers, validateSubvers, writeSubvers } from "./subvers.mjs";

/** 子命令清单（完整 CLI 路由校验 + 命令树守卫用） */
export const VER_SUBCOMMANDS = ["list", "reach", "reopen", "claim", "release", "lanes"];

/** 每个子命令收哪些旗标（写错就拒，不静默忽略） */
export const VER_SUB_FLAGS = {
  list: ["json"],
  reach: ["on", "note", "confirm", "json", "force"],
  reopen: ["json", "confirm", "force", "reason"],
  claim: ["as", "note", "json", "force"],
  release: ["as", "json", "force"],
  lanes: ["json"],
};

export const VER_USAGE = [
  "  gd ver list [--json]",
  '  gd ver reach <x.y.z> --confirm <x.y.z> [--on <YYYY-MM-DD>] [--note "…"]     结版（须用户确认 · 铁律）',
  '  gd ver reopen <x.y.z> --confirm <x.y.z> --reason "…"                        撤销结版（须点名 + 必须写理由）',
  '  gd ver claim <x.y> [--as <名字>] [--note "…"] [--force]                     认领版本线',
  '  gd ver release <x.y> [--as <名字>] [--force]                                释放版本线',
  '  gd ver lanes [--json]                                                       版本线清单',
].join("\n");

// ── plan 基元 ───────────────────────────────────────────────

/** 成功回显（lines 走 stdout） */
const ok = (lines) => ({ ok: true, lines: lines.filter((l) => l !== null && l !== undefined) });
/** 失败回显（lines 走 stderr；`code` 缺省 1） */
const bad = (lines, code = 1) => ({ ok: false, code, lines: lines.flat().filter((l) => l !== null && l !== undefined) });
/** `--json` 分支：单行 JSON（结构由各子命令定，与旧 CLI 逐字段一致） */
const asJson = (obj) => ok([JSON.stringify(obj, null, 2)]);

/** 版本 / 子版号排序（`0.23.9` 排在 `0.23.10` 前面） */
const byVer = (a, b) => a.localeCompare(b, "en", { numeric: true });
/** `--on` 归一到 `YYYY-MM-DD`（缺省今天）：参数闸门与写账共用一份 */
const onOf = (on) => (on === null || on === undefined ? dateStrOf() : String(on));

// ── 参数闸门（在定位板之前跑：参数错就报参数错，别拿「无板」盖住自己的手误）──

/** 子版号形态校验（`x.y.z`） */
export function checkSubverArg(alias) {
  const a = String(alias ?? "").trim();
  if (isSubver(a)) return null;
  return bad([`✗ 子版号形态非法：${a || "（空）"}（应为 x.y.z）`, "", VER_USAGE]);
}

/** `ver reach` 的参数闸门：子版号 → 点名确认 → `--on` 形态 */
export function checkReachArgs({ alias, on = null, confirm = null }) {
  const bad1 = checkSubverArg(alias);
  if (bad1) return bad1;
  const a = String(alias ?? "").trim();
  if (!isConfirmed({ confirm }, a)) return bad([`✗ ${confirmHint("gd ver reach", a)}`]);
  const onStr = on === true ? "" : onOf(on);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(onStr)) return bad([`✗ --on 需 YYYY-MM-DD（现值：${onStr}）`]);
  return null;
}

/** `ver reopen` 的参数闸门：子版号 → 点名确认 → 理由必填（顺序即报错顺序） */
export function checkReopenArgs({ alias, reason = "", confirm = null }) {
  const bad1 = checkSubverArg(alias);
  if (bad1) return bad1;
  const a = String(alias ?? "").trim();
  if (!isConfirmed({ confirm }, a)) return bad([`✗ ${confirmHint("gd ver reopen", a)}`]);
  const r = String(reason ?? "").trim();
  if (!r) {
    return bad([
      '✗ 撤销结版必须写理由：--reason "为什么宣告有误"',
      out.dim("  · reopen 的语义是「我之前的宣告有误」（漏了需求 / 验收结论被证伪），不是「又发现了 bug」"),
      out.dim("  · 结版后新发现的缺陷 ⇒ 开新子版修，不 reopen（见 protocol §3.7）"),
    ]);
  }
  return null;
}

/** 版本号形态校验（`x.y`） */
export function checkVersionArg(version) {
  const v = String(version ?? "").trim();
  if (isVersion(v)) return null;
  return bad([`✗ 版本号形态非法：${v || "（空）"}（应为 x.y，如 0.22）`, "", VER_USAGE]);
}

// ── ver list ────────────────────────────────────────────────

/** 子版清单（完成度派生自需求；结版态来自 subvers.yaml） */
export function verListPlan({ board, json = false }) {
  const sv = readSubvers(board.root);
  if (!sv.ok) return bad([`✗ 子版账读取失败：${sv.error}`]);
  const recordOf = closedOf(sv.list);
  const rows = [...subverReqs(board.root).entries()].sort(([a], [b]) => byVer(a, b)).map(([alias, reqs]) => {
    const record = recordOf(alias);
    return {
      alias,
      reqs: reqs.map((r) => r.id),
      done: reqs.every((r) => r.status === "done"),
      reached_on: record?.reached_on ?? null,
      note: record?.note ?? null,
    };
  });
  if (json) return asJson({ ok: true, board: board.id, subvers: rows });
  if (rows.length === 0) return ok([out.dim(`板 ${board.id}：还没有带子版号的需求（需求登记时带 --subver x.y.z）`)]);
  const lines = [`板 ${board.id} · 子版 ${rows.length} 条（已完成 = 需求全验收；已结版 = 人已宣告）`, "   子版      需求                        完成  结版"];
  for (const r of rows) {
    const doneCell = r.done ? "✅" : "—";
    const closedCell = r.reached_on ? `✅ ${r.reached_on}` : r.done ? "待结版" : "—";
    lines.push(`   ${r.alias.padEnd(9)} ${r.reqs.join(",").padEnd(26)} ${doneCell.padEnd(4)} ${closedCell}`);
  }
  return ok(lines);
}

// ── ver reach（结版）────────────────────────────────────────

/**
 * 结版（**人要点头**）。三道闸门按序：版本线归属 → 阻塞缺陷 → 写账校验。
 * @param {object} o
 * @param {object} o.board 板（`board.root` 为账根）
 * @param {string} o.alias 子版号 x.y.z
 * @param {string|null} [o.on] 结版日（缺省今天）
 * @param {string} [o.note]
 * @param {boolean} [o.force] 越过闸门（事件里留痕）
 * @param {boolean} [o.json]
 */
export function verReachPlan({ board, alias, on = null, note = "", force = false, json = false }) {
  const a = String(alias ?? "").trim();
  const gate = assertLane(board.root, a, { board, force });
  if (gate) return bad([`✗ ${gate.error}`, `  · ${gate.hint}`]);
  // 「已完成」≠「可结版」：本子版还有未完成的 blocker 缺陷时不许结
  const blockers = openBlockersOf(readReqEntries(board.root), a);
  if (blockers.length > 0 && !force) {
    return bad([
      `✗ 子版 ${a} 还有 ${blockers.length} 条未完成的阻塞缺陷（blocker），不许结版`,
      ...blockers.map((b) => `  · ${b.id} ${b.status} — ${b.title}`),
      out.dim("  · 修完并验收后再结版；若这条缺陷其实不阻塞，改定级：需求更新命令把 --severity 改 major"),
      out.dim("  · 确认要继续（不推荐）可加 --force，但事件里会留下越过记录"),
    ]);
  }
  const onStr = onOf(on);
  return withBoardLock(board.root, () => {
    const fresh = readSubvers(board.root);
    if (!fresh.ok) return bad([`✗ 子版账读取失败：${fresh.error}`]);
    const others = fresh.list.filter((s) => s.alias !== a);
    const existing = fresh.list.find((s) => s.alias === a);
    const reachedOn = existing?.reached_on ?? onStr;
    const next = [...others, { alias: a, reached_on: reachedOn, note: note || existing?.note || "" }];
    const errs = validateSubvers(next);
    if (errs.length > 0) return bad([`✗ 写入校验未通过：${errs.map((e) => e.msg).join(" / ")}`]);
    writeSubvers(board.root, next);
    if (json) return asJson({ ok: true, board: board.id, alias: a, reached_on: reachedOn, idempotent: !!existing });
    return ok([
      out.ok(`✅ 子版 ${a} 已结版（${reachedOn}）${existing ? "——幂等：不改既有日期" : ""}`),
      out.dim("  · 结版是人的宣告（铁律：须用户确认）；完成度仍由需求派生"),
    ]);
  });
}

// ── ver reopen（撤销结版）──────────────────────────────────

/** 撤销结版（须点名 + 理由；本未结版则幂等返回） */
export function verReopenPlan({ board, alias, reason = "", json = false }) {
  const a = String(alias ?? "").trim();
  const why = String(reason ?? "").trim();
  return withBoardLock(board.root, () => {
    const fresh = readSubvers(board.root);
    if (!fresh.ok) return bad([`✗ 子版账读取失败：${fresh.error}`]);
    const hit = fresh.list.find((s) => s.alias === a);
    if (!hit) {
      if (json) return asJson({ ok: true, alias: a, reopened: false, reason: "本就未结版" });
      return ok([out.dim(`· 子版 ${a} 本就未结版，无需撤销`)]);
    }
    writeSubvers(board.root, fresh.list.filter((s) => s.alias !== a));
    if (json) return asJson({ ok: true, alias: a, reopened: true, was_reached_on: hit.reached_on, reason: why });
    return ok([out.ok(`✅ 子版 ${a} 已撤销结版（原 ${hit.reached_on}）`), out.dim(`  · 理由：${why}`)]);
  });
}

// ── 版本线：claim / release / lanes ─────────────────────────
//
// 版本线 = 「这条 x.y 归谁管」的一块账（`<板根>/lanes.yaml`）。判据与回显同样只有这一份：
//   · claim / release 写账（他人持有 ⇒ 拒，`--force` 可改归 / 释放）；
//   · lanes 是**派生视图**：把「认领记录」与「需求里出现过的 x.y」合并成一张清单，
//     每条线再挂上它的子版与结版态（子版清单本身派生自需求，不另存一份）。

/** 子版号 → 需求清单（派生自需求；`ver list` 与「版 → 子版」共用这一次扫描） */
function subverReqs(root) {
  const byAlias = new Map();
  for (const r of readReqEntries(root)) {
    const v = String(r.subver ?? "").trim();
    if (!isSubver(v)) continue;
    if (!byAlias.has(v)) byAlias.set(v, []);
    byAlias.get(v).push({ id: String(r.id), status: String(r.status ?? "") });
  }
  return byAlias;
}

/** 版 → 子版清单（派生自需求；lanes 清单展示用。每个子版只出现一次） */
function subversByVersion(root) {
  const byVersion = new Map();
  for (const alias of subverReqs(root).keys()) {
    const ver = versionOfSubver(alias);
    if (!byVersion.has(ver)) byVersion.set(ver, []);
    byVersion.get(ver).push(alias);
  }
  return byVersion;
}

/** 子版号 → 版本号（`0.23.1` ⇒ `0.23`） */
function versionOfSubver(subver) {
  return String(subver ?? "").trim().split(".").slice(0, 2).join(".");
}

/**
 * 认领版本线（谁负责这条线）。
 * @param {object} o
 * @param {object} o.board 板
 * @param {string} o.version 版本号 x.y
 * @param {string} [o.as] 认领人（缺省取当前身份）
 * @param {string} [o.note]
 * @param {boolean} [o.force] 越过「他人已持有」
 * @param {boolean} [o.json]
 * @param {object} [o.env] 当前环境（取身份用）
 */
export function verClaimPlan({ board, version, as = "", note = "", force = false, json = false, env = process.env }) {
  const v = String(version ?? "").trim();
  const who = String(as ?? "").trim() || actorOf(env, board);
  return withBoardLock(board.root, () => {
    const fresh = readLanes(board.root);
    if (!fresh.ok) return bad([`✗ 版本线账读取失败：${fresh.error}`]);
    const prev = fresh.list.find((l) => l.version === v);
    if (prev && prev.owner !== who && !force) {
      return bad([
        `✗ 版本线 ${v} 已归 ${prev.owner} 所有（自 ${prev.since || "—"}）`,
        `  · 确需改归加 --force；或让 ${prev.owner} 先释放：gd ver release ${v}`,
      ]);
    }
    const since = prev && prev.owner === who ? prev.since : dateStrOf();
    const next = [...fresh.list.filter((l) => l.version !== v), { version: v, owner: who, since, note: note || (prev?.note ?? "") }];
    const errs = validateLanes(next);
    if (errs.length > 0) return bad([`✗ 写入校验未通过：${errs.map((e) => e.msg).join(" / ")}`]);
    writeLanes(board.root, next);
    const forced = !!prev && prev.owner !== who;
    if (json) return asJson({ ok: true, board: board.id, version: v, owner: who, since, forced });
    return ok([
      out.ok(`✅ 版本线 ${v} 归 ${who}（自 ${since}）${forced ? `（原 ${prev.owner}，--force 越过）` : ""}`),
      out.dim(`  · 该线的需求 / 任务 / 结版写面：他人需 GD_EXECUTOR=${who} 或 --force`),
    ]);
  });
}

/** 释放版本线（owner 本人或 `--force`；本无归属 ⇒ 幂等返回） */
export function verReleasePlan({ board, version, as = "", force = false, json = false, env = process.env }) {
  const v = String(version ?? "").trim();
  const who = String(as ?? "").trim() || actorOf(env, board);
  return withBoardLock(board.root, () => {
    const fresh = readLanes(board.root);
    if (!fresh.ok) return bad([`✗ 版本线账读取失败：${fresh.error}`]);
    const lane = fresh.list.find((l) => l.version === v);
    if (!lane) {
      if (json) return asJson({ ok: true, version: v, released: false, reason: "本无归属" });
      return ok([out.dim(`· 版本线 ${v} 本无归属，无需释放`)]);
    }
    if (lane.owner !== who && !force) return bad([`✗ 版本线 ${v} 归 ${lane.owner}，非本人释放需 --force（当前身份 ${who}）`]);
    writeLanes(board.root, fresh.list.filter((l) => l.version !== v));
    if (json) return asJson({ ok: true, version: v, released: true, was_owner: lane.owner });
    return ok([out.ok(`✅ 版本线 ${v} 已释放（原 ${lane.owner}）`)]);
  });
}

/** 版本线清单（认领记录 ∪ 需求里出现过的 x.y；每条线挂子版与结版态） */
export function verLanesPlan({ board, json = false, env = process.env }) {
  const lanes = readLanes(board.root);
  if (!lanes.ok) return bad([`✗ 版本线账读取失败：${lanes.error}`]);
  const me = actorOf(env, board);
  const sv = readSubvers(board.root);
  const closed = closedOf(sv.ok ? sv.list : []);
  const byVersion = subversByVersion(board.root);
  const versions = [...new Set([...lanes.list.map((l) => l.version), ...byVersion.keys()])].sort(byVer);
  const rows = versions.map((version) => {
    const lane = lanes.list.find((l) => l.version === version) ?? null;
    const subs = [...(byVersion.get(version) ?? [])].sort(byVer);
    return {
      version,
      owner: lane?.owner ?? null,
      since: lane?.since ?? null,
      mine: lane ? lane.owner === me : null,
      subvers: subs.map((a) => ({ alias: a, closed: !!closed(a) })),
    };
  });
  if (json) return asJson({ ok: true, board: board.id, me, lanes: rows });
  if (rows.length === 0) return ok([out.dim(`板 ${board.id}：还没有版本线（gd ver claim <x.y> --as <名字>）`)]);
  const lines = [`板 ${board.id} · 当前身份 ${me} · 版本线 ${rows.length} 条`, "   版本   归属        子版(结版)"];
  for (const r of rows) {
    const owner = r.owner ? `${r.owner}${r.mine ? "（我）" : ""}` : "— 未认领";
    const subs = r.subvers.length ? r.subvers.map((s) => `${s.alias}${s.closed ? "✅" : ""}`).join(",") : "—";
    lines.push(`   ${r.version.padEnd(6)} ${owner.padEnd(11)} ${subs}`);
  }
  return ok(lines);
}

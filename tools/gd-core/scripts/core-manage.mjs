/**
 * core-manage —— **core 层**的管理面（改 / 结 / 撤）
 *
 * 为什么要有它：core-only 的机器（只装 gd-core 包）原先只能 `add`（建里程碑 / 建需求 / 拆任务），
 *   连「建完需求再挂里程碑」这一步都做不到 —— 而 protocol §3.6 规定的标准顺序正是先建需求再挂。
 *   管理面补的就是这条闭环：**开 → 挂 → 干 → 结 → （错了）撤**。
 *
 * 命令面（core 自足，不碰注册表 / 席位 / git）：
 *   gd-core milestone update <id> [--name|--target|--status|--on|--alias|--req-add|--req-remove|--note]
 *   gd-core milestone reach  <id> --confirm <id> [--on <YYYY-MM-DD>]
 *   gd-core milestone reopen <id> --confirm <id>
 *   gd-core milestone remove <id>
 *   gd-core req update <需求id> [--title|--summary|--kind|--severity|--found-in|--affects|--subver]
 *   gd-core req delete <需求id> [--force]
 *   gd-core task update <任务id> [--title|--input|--executor] [--req <需求id>]
 *   gd-core task delete <任务id> [--req <需求id>]
 *
 * 判据与完整 CLI 同源（`lib/board-plans.mjs` / `lib/milestones.mjs` / `lib/reqflow.mjs`），
 * 只是少了宿主能力：注册项目账（`--project`）与写后自动提交 / 推送。
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, rejectArgs, unknownFlags } from "./lib/args.mjs";
import { noBoardMessage, resolveBoardAccount } from "./lib/board-account.mjs";
import { appendEvents, readReqEntries, readTaskLedger, updateReqIndexField, withBoardLock, writeTaskLedger } from "./lib/board.mjs";
import { autoBackupBoard, backupOutcomeLines } from "./lib/board-vcs.mjs"; // 0.29.9 R-gm-105：结版 = 指定的异地备份检查点
import { milestoneWrittenLines, prepareMilestoneWrite, writeMilestoneList } from "./lib/board-plans.mjs";
import { confirmHint, isConfirmed } from "./lib/confirm.mjs";
import { affectsText, validateDefectFields } from "./lib/defects.mjs";
import { REQ_DONE_STATUSES, dateStrOf, findMilestone, planMilestoneVerPatch, readMilestones } from "./lib/milestones.mjs";
import { removeReqFromIndex, reqDirOf, updateTaskField } from "./lib/reqflow.mjs";
import { readSubvers, isSubver } from "./lib/subvers.mjs";
import { errOut, out } from "./lib/style.mjs";

export const MILESTONE_MANAGE_SUBCOMMANDS = ["update", "reach", "reopen", "remove"];
export const REQ_MANAGE_SUBCOMMANDS = ["update", "delete"];
export const TASK_MANAGE_SUBCOMMANDS = ["update", "delete"];

const CORE_MANAGE_USAGE = [
  "  gd-core milestone update <id> [--name|--target|--status|--on|--alias|--req-add|--req-remove|--note]",
  "      --ver <x.y|\"\">：给存量卡标定它占的版本线 / 清除版号（开发线卡拒；已达成的卡要 --confirm）",
  "  gd-core milestone reach  <id> --confirm <id> [--on <YYYY-MM-DD>]      达成（铁律：须点名）",
  "  gd-core milestone reopen <id> --confirm <id>                          退档（撤销达成）",
  "  gd-core milestone remove <id>",
  "  gd-core req update <需求id> [--title|--summary|--kind|--severity|--found-in|--affects|--subver]",
  "  gd-core req delete <需求id> [--force]",
  "  gd-core task update <任务id> [--title|--input|--executor] [--req <需求id>]",
  "  gd-core task delete <任务id> [--req <需求id>]",
  "  （落点：本仓的板 · 临时切板 export GD_BOARD=<板根目录>；注册项目账 / 写后提交属完整 CLI）",
].join("\n");

/** 三族共用的「未知旗标」白名单外键 */
const ACCT_ALLOWED = ["board", "main-local"];

const listOf = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : typeof v === "string" ? [v] : []);

const needBoard = (cmd, acct) => {
  console.error(errOut.err(noBoardMessage(cmd, acct)));
  return 1;
};

/** 板上下文 + 未知旗标闸门的公共前置；返回 `{board}` 或 `{code}` */
function enter(cmd, argv, { multi = [], allowed }) {
  const args = parseArgs(argv, multi);
  const unknown = unknownFlags(args, [...allowed, ...ACCT_ALLOWED], "core 面不认识");
  if (unknown.length > 0) return { code: rejectArgs(unknown, CORE_MANAGE_USAGE) };
  const acct = resolveBoardAccount({ wantBoard: args.board === true });
  if (acct.mode === "none") return { code: needBoard(cmd, acct) };
  return { args, board: acct.board };
}

// ── milestone ─────────────────────────────────────────────────────────

/** `gd-core milestone update|reach|reopen|remove` */
export function runMilestoneManage(sub, argv = []) {
  const subName = String(sub ?? "");
  if (!MILESTONE_MANAGE_SUBCOMMANDS.includes(subName)) {
    console.error(errOut.err(`✗ core 面没有 "milestone ${subName}"（管理面）。可用：${MILESTONE_MANAGE_SUBCOMMANDS.join(" / ")}`));
    console.error(`用法：\n${CORE_MANAGE_USAGE}`);
    return 1;
  }
  const multi = ["req-add", "req-remove"];
  const allowed =
    subName === "update"
      ? ["name", "target", "status", "on", "alias", "req-add", "req-remove", "note", "ver", "confirm"]
      : subName === "reach"
        ? ["on", "confirm"]
        : subName === "reopen"
          ? ["confirm"]
          : [];
  const gate = enter(`gd-core milestone ${subName}`, argv, { multi, allowed });
  if (gate.code !== undefined) return gate.code;
  const { args, board } = gate;

  const idArg = typeof args._[0] === "string" ? args._[0] : "";
  if (!idArg.trim()) {
    console.error(errOut.err(`✗ 缺少里程碑 id（gd-core milestone ${subName} <id>）`));
    console.error(`用法：\n${CORE_MANAGE_USAGE}`);
    return 1;
  }
  const r = readMilestones(board.root);
  if (!r.ok) {
    console.error(errOut.err(`✗ <板根>/milestones.yaml 读取失败：${r.error}`));
    return 1;
  }
  const cur = findMilestone(r.list, idArg);
  if (!cur) {
    console.error(errOut.err(`✗ 未找到里程碑 ${idArg}（gd-core milestone list 查看现有条目）`));
    return 1;
  }

  if (subName === "remove") {
    const next = r.list.filter((m) => m !== cur);
    const w = prepareMilestoneWrite({ projDir: board.root, list: next });
    if (!w.ok) {
      for (const line of w.lines) console.error(line);
      return 1;
    }
    writeMilestoneList({ projDir: board.root, list: next, label: "milestone remove" });
    for (const line of milestoneWrittenLines({ action: `删除里程碑 ${cur.id}`, summary: cur.name ?? cur.id, view: w.view })) console.log(line);
    return 0;
  }

  // reach / reopen 是宣告动作 ⇒ 铁律：必须点名确认（与完整 CLI 同口径）
  if (subName === "reach" || subName === "reopen") {
    if (!isConfirmed(args, cur.id)) {
      console.error(errOut.err(`✗ ${confirmHint(`gd-core milestone ${subName}`, cur.id)}`));
      return 1;
    }
    if (subName === "reach" && cur.status === "reached") {
      console.log(out.dim(`· 里程碑 ${cur.id} 已是「已达成」（${cur.reached_on ?? "未记日期"}）——幂等，不改日期`));
      return 0;
    }
    if (subName === "reopen" && cur.status !== "reached") {
      console.log(out.dim(`· 里程碑 ${cur.id} 当前不处于「已达成」——无需退档`));
      return 0;
    }
    const patch =
      subName === "reach"
        ? { status: "reached", reached_on: typeof args.on === "string" ? args.on : dateStrOf() }
        : { status: "in_progress", reached_on: null };
    return commitMilestonePatch({
      board,
      list: r.list,
      cur,
      patch,
      action: subName === "reach" ? `达成里程碑 ${cur.id}` : `退档里程碑 ${cur.id}`,
      // 结版 = 指定的异地备份检查点（0.29.9 R-gm-105）；退档不是（账往回走，没有要封存的交付事实）
      backup: subName === "reach",
    });
  }

  // update
  const patch = {};
  if (typeof args.name === "string") patch.name = args.name;
  if (typeof args.target === "string") patch.target = args.target;
  if (typeof args.note === "string") patch.note = args.note;
  if (typeof args.alias === "string") patch.alias = args.alias.trim() || null;
  if (typeof args.status === "string" && args.status) patch.status = args.status;

  const add = listOf(args["req-add"]);
  const del = listOf(args["req-remove"]);
  // 已达成 = 历史时间锚：达成判据就是「关联需求全部验收通过」，事后改关联只会造自相矛盾的账
  if (cur.status === "reached" && (add.length > 0 || del.length > 0)) {
    console.error(errOut.err(`✗ ${cur.id} 已于 ${cur.reached_on ?? "—"} 达成——已达成的里程碑不能再挂 / 解关联需求`));
    console.error(out.dim(`  · 要往后走请先 gd-core milestone reopen ${cur.id}，或另建一张里程碑`));
    return 1;
  }
  // 需求 ↔ 里程碑 1:1：已被别的卡持有就拒（与完整 CLI 同判据）
  if (add.length > 0) {
    const holder = new Map();
    for (const other of r.list) {
      if (String(other.id) === String(cur.id)) continue;
      for (const x of other.reqs ?? []) if (!holder.has(String(x))) holder.set(String(x), String(other.id ?? ""));
    }
    const taken = add.filter((x) => holder.has(String(x)));
    if (taken.length > 0) {
      console.error(errOut.err(`✗ 一个需求只能关联一个里程碑：${taken.map((x) => `${x} 已挂在 ${holder.get(String(x))}`).join(" / ")}`));
      console.error(out.dim(`  · 先去原里程碑解关联：gd-core milestone update ${holder.get(String(taken[0]))} --req-remove ${taken[0]}`));
      return 1;
    }
  }
  if (patch.status === "reached") patch.reached_on = typeof args.on === "string" ? args.on : (cur.reached_on ?? dateStrOf());
  else if (patch.status) patch.reached_on = null;
  if (add.length > 0 || del.length > 0) {
    const set = new Set([...(cur.reqs ?? []), ...add]);
    for (const d of del) set.delete(d);
    patch.reqs = [...set];
  }
  // 版号写入口（与完整 CLI 同口径：lib/milestones.mjs: planMilestoneVerPatch）
  let events = null;
  let verPlan = null;
  if (args.ver !== undefined) {
    verPlan = planMilestoneVerPatch({ list: r.list, cur, rawVer: args.ver, confirmed: isConfirmed(args, cur.id) });
    if (!verPlan.ok) {
      console.error(errOut.err(`✗ ${verPlan.error}`));
      if (verPlan.hint) console.error(out.dim(`  · ${verPlan.hint}`));
      return 1;
    }
    if (!verPlan.unchanged) {
      Object.assign(patch, verPlan.patch);
      const trace = `版本号留痕（${dateStrOf()}）：${verPlan.trace}`;
      const baseNote = String(typeof args.note === "string" ? args.note : cur.note ?? "").trim();
      patch.note = [baseNote, trace].filter(Boolean).join(" · ");
      events = [{ reqId: null, entries: [{ actor: "core", kind: "note", text: `里程碑 ${cur.id} 版号变更：${verPlan.trace}` }] }];
    }
  }
  if (Object.keys(patch).length === 0) {
    if (verPlan?.unchanged) {
      // 幂等：--ver 给的值与账上一致 ⇒ 无事可写，当成功回显
      console.log(out.dim(`· ${cur.id} 的版号没变（${verPlan.trace}）——无事可写`));
      return 0;
    }
    console.error(errOut.err("✗ 没有要改的字段（--name / --target / --status / --on / --alias / --req-add / --req-remove / --note / --ver）"));
    console.error(`用法：\n${CORE_MANAGE_USAGE}`);
    return 1;
  }
  return commitMilestonePatch({ board, list: r.list, cur, patch, action: `更新里程碑 ${cur.id}`, events });
}

/** 打补丁 → 校验 → 落盘（core 面统一出口） */
function commitMilestonePatch({ board, list, cur, patch, action, backup = false, events = null }) {
  const next = list.map((m) => (m === cur ? { ...m, ...patch } : m));
  const w = prepareMilestoneWrite({ projDir: board.root, list: next });
  if (!w.ok) {
    for (const line of w.lines) console.error(line);
    return 1;
  }
  writeMilestoneList({ projDir: board.root, list: next, label: "milestone 写", events });
  const changed = Object.keys(patch)
    .map((k) => `${k}=${patch[k] === null || patch[k] === "" ? "—" : patch[k]}`)
    .join(" · ");
  for (const line of milestoneWrittenLines({ action, summary: `${patch.name ?? cur.name}（${changed}）`, view: w.view })) console.log(line);
  if (backup) {
    for (const line of backupOutcomeLines(autoBackupBoard({ root: board.root, repo: board.repo }), "gd-core")) console.log(line);
  }
  return 0;
}

// ── req ───────────────────────────────────────────────────────────────

/** `gd-core req update|delete` */
export function runReqManage(sub, argv = []) {
  const subName = String(sub ?? "");
  if (!REQ_MANAGE_SUBCOMMANDS.includes(subName)) {
    console.error(errOut.err(`✗ core 面没有 "req ${subName}"（管理面）。可用：${REQ_MANAGE_SUBCOMMANDS.join(" / ")}`));
    console.error(`用法：\n${CORE_MANAGE_USAGE}`);
    return 1;
  }
  const allowed =
    subName === "update" ? ["title", "summary", "kind", "severity", "found-in", "affects", "subver"] : ["force"];
  const gate = enter(`gd-core req ${subName}`, argv, { multi: [], allowed });
  if (gate.code !== undefined) return gate.code;
  const { args, board } = gate;

  const reqId = typeof args._[0] === "string" ? args._[0] : "";
  if (!reqId.trim()) {
    console.error(errOut.err(`✗ 缺少需求 id（gd-core req ${subName} <需求id>）`));
    console.error(`用法：\n${CORE_MANAGE_USAGE}`);
    return 1;
  }
  const entries = readReqEntries(board.root);
  const entry = entries.find((e) => String(e.id) === String(reqId));
  if (!entry) {
    console.error(errOut.err(`✗ 需求 "${reqId}" 不在板 ${board.id} 的账里（gd-core req list 看板上有什么）`));
    return 1;
  }
  return subName === "update" ? reqUpdate({ board, args, reqId, entry }) : reqDelete({ board, args, reqId, entry, entries });
}

function reqUpdate({ board, args, reqId, entry }) {
  const patch = {};
  if (typeof args.title === "string") patch.title = args.title.trim();
  if (typeof args.summary === "string") patch.summary = args.summary;
  if (typeof args.subver === "string") {
    const sv = args.subver.trim();
    if (sv && !isSubver(sv)) {
      console.error(errOut.err(`✗ --subver 需 x.y.z 形态（现值：${sv}）`));
      return 1;
    }
    patch.subver = sv;
  }
  const defectTouched = ["kind", "severity", "found-in", "affects"].some((k) => typeof args[k] === "string");
  if (defectTouched) {
    const merged = {
      kind: typeof args.kind === "string" ? args.kind : (entry.kind ?? "feature"),
      severity: typeof args.severity === "string" ? args.severity : (entry.severity ?? ""),
      found_in: typeof args["found-in"] === "string" ? args["found-in"] : (entry.found_in ?? ""),
      affects: typeof args.affects === "string" ? String(args.affects).split(",").map((v) => v.trim()).filter(Boolean) : [],
    };
    const bad = validateDefectFields(merged);
    if (bad) {
      console.error(errOut.err(`✗ ${bad.error}`));
      console.error(`  · ${bad.hint}`);
      return 1;
    }
    patch.kind = merged.kind === "feature" ? "" : merged.kind; // feature 不落盘（存量零 diff）
    patch.severity = merged.severity;
    patch.found_in = merged.found_in;
    patch.affects = affectsText(merged.affects);
  }
  const fields = Object.keys(patch);
  if (fields.length === 0) {
    console.error(errOut.err("✗ 没有要改的字段（--title / --summary / --kind / --severity / --found-in / --affects / --subver）"));
    console.error(`用法：\n${CORE_MANAGE_USAGE}`);
    return 1;
  }
  withBoardLock(board.root, () => {
    for (const [k, v] of Object.entries(patch)) updateReqIndexField(board.root, reqId, k, v);
  });
  console.log(out.ok(`✅ 需求已更新：${reqId}`));
  console.log(`  改动：${fields.map((k) => `${k}=${patch[k] === "" ? "—" : patch[k]}`).join(" · ")}`);
  return 0;
}

/**
 * 删需求（0.24.2 R-gm-081 的三条规则，core 同口径）：
 *   ① 子版已结版 ⇒ 拒（历史已宣告，不许改写；要废就新开需求说明）
 *   ② 需求下有 review 任务 ⇒ 拒（在途）；有 done 任务 ⇒ 需 `--force`（有客观产出）
 *   ③ 从里程碑 `reqs` 与需求索引同时摘除（同一把锁内），并留事件
 */
function reqDelete({ board, args, reqId, entry, entries }) {
  const force = args.force === true;
  const subver = String(entry.subver ?? "").trim();
  const ledger = readTaskLedger(board.root, reqId);
  const tasks = ledger.tasks ?? [];

  if (subver && isSubver(subver)) {
    const sv = readSubvers(board.root);
    const closed = sv.ok ? sv.list.find((s) => s.alias === subver) : null;
    if (closed) {
      console.error(errOut.err(`✗ 子版 ${subver} 已于 ${closed.reached_on} 结版——已宣告的历史不许改写`));
      console.error(out.dim("  · 要废这条需求：另开一条需求说明（gd-core req new \"作废说明：<原 id>\"）"));
      return 1;
    }
  }
  const inReview = tasks.filter((t) => t.status === "review");
  if (inReview.length > 0) {
    console.error(errOut.err(`✗ 需求 ${reqId} 下还有 ${inReview.length} 个待验收任务（${inReview.map((t) => t.id).join(" / ")}）——在途不可删`));
    console.error(out.dim("  · 先结掉或退回：gd-core check <任务id> --pass | --reject \"…\""));
    return 1;
  }
  const doneCount = tasks.filter((t) => t.status === "done").length;
  if (doneCount > 0 && !force) {
    console.error(errOut.err(`✗ 需求 ${reqId} 下有 ${doneCount} 个已验收任务（有客观产出）——确要删加 --force`));
    return 1;
  }
  if (REQ_DONE_STATUSES.has(String(entry.status ?? "")) && !force) {
    console.error(errOut.err(`✗ 需求 ${reqId} 已验收完成——确要删加 --force`));
    return 1;
  }

  const dir = reqDirOf(board.root, reqId);
  withBoardLock(board.root, () => {
    // ① 从所有里程碑的 reqs 摘除（防止悬空引用）
    const ms = readMilestones(board.root);
    if (ms.ok) {
      const touched = ms.list.filter((m) => (m.reqs ?? []).map(String).includes(String(reqId)));
      if (touched.length > 0) {
        const next = ms.list.map((m) =>
          (m.reqs ?? []).map(String).includes(String(reqId)) ? { ...m, reqs: (m.reqs ?? []).filter((x) => String(x) !== String(reqId)) } : m,
        );
        const w = prepareMilestoneWrite({ projDir: board.root, list: next });
        if (w.ok) writeMilestoneList({ projDir: board.root, list: next, label: "req delete 摘关联" });
      }
    }
    // ② 留下删除事件再删目录（删完就没地方写了）
    if (existsSync(join(dir, "events.jsonl"))) {
      appendEvents(board.root, reqId, [{ actor: "core", kind: "note", text: `需求删除：${entry.title ?? ""}${doneCount ? `（含 ${doneCount} 个已验收任务 · --force）` : ""}` }]);
    }
    // ③ 从索引摘除 + 删需求目录
    removeReqFromIndex(board.root, reqId);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  console.log(out.ok(`✅ 需求已删除：${reqId}（${entry.title ?? ""}）`));
  console.log(out.dim(`  · 已从索引与里程碑关联摘除${doneCount ? `，连带 ${doneCount} 个已验收任务` : ""}；剩 ${entries.length - 1} 条需求`));
  return 0;
}

// ── task ──────────────────────────────────────────────────────────────

/** `gd-core task update|delete` */
export function runTaskManage(sub, argv = []) {
  const subName = String(sub ?? "");
  if (!TASK_MANAGE_SUBCOMMANDS.includes(subName)) {
    console.error(errOut.err(`✗ core 面没有 "task ${subName}"（管理面）。可用：${TASK_MANAGE_SUBCOMMANDS.join(" / ")}`));
    console.error(`用法：\n${CORE_MANAGE_USAGE}`);
    return 1;
  }
  const allowed = subName === "update" ? ["title", "input", "executor", "req"] : ["req"];
  const gate = enter(`gd-core task ${subName}`, argv, { multi: [], allowed });
  if (gate.code !== undefined) return gate.code;
  const { args, board } = gate;

  const taskId = typeof args._[0] === "string" ? args._[0] : "";
  if (!taskId.trim()) {
    console.error(errOut.err(`✗ 缺少任务 id（gd-core task ${subName} <任务id>）`));
    console.error(`用法：\n${CORE_MANAGE_USAGE}`);
    return 1;
  }
  const reqHint = typeof args.req === "string" ? args.req.trim() : null;
  const reqIds = reqHint ? [reqHint] : readReqEntries(board.root).map((r) => String(r.id));
  let found = null;
  for (const reqId of reqIds) {
    const ledger = readTaskLedger(board.root, reqId);
    const task = (ledger.tasks ?? []).find((t) => String(t.id) === taskId);
    if (task) {
      found = { reqId, ledger, task };
      break;
    }
  }
  if (!found) {
    console.error(errOut.err(`✗ 找不到任务 ${taskId}${reqHint ? `（需求 ${reqHint}）` : "（可用 --req <需求id> 缩小范围）"}`));
    return 1;
  }
  return subName === "update" ? taskUpdate({ board, args, taskId, found }) : taskDelete({ board, taskId, found });
}

function taskUpdate({ board, args, taskId, found }) {
  const fields = ["title", "input", "executor"].filter((k) => typeof args[k] === "string");
  if (fields.length === 0) {
    console.error(errOut.err("✗ 没有要改的字段（--title / --input / --executor）"));
    console.error(`用法：\n${CORE_MANAGE_USAGE}`);
    return 1;
  }
  withBoardLock(board.root, () => {
    for (const k of fields) updateTaskField(board.root, found.reqId, taskId, k, args[k]);
  });
  console.log(out.ok(`✅ 任务已更新：${taskId}（需求 ${found.reqId}）`));
  console.log(`  改动：${fields.map((k) => `${k}=${k === "input" ? "（已替换）" : args[k]}`).join(" · ")}`);
  return 0;
}

function taskDelete({ board, taskId, found }) {
  if (String(found.task.status ?? "") === "review") {
    console.error(errOut.err(`✗ 任务 ${taskId} 在待验收状态——在途不可删`));
    console.error(out.dim(`  · 先结掉或退回：gd-core check ${taskId} --pass | --reject "…"`));
    return 1;
  }
  withBoardLock(board.root, () => {
    const ledger = readTaskLedger(board.root, found.reqId);
    const next = (ledger.tasks ?? []).filter((t) => String(t.id) !== taskId);
    writeTaskLedger(board.root, found.reqId, { req: ledger.req, tasks: next }, { expectedRev: ledger.revision });
    appendEvents(board.root, found.reqId, [{ actor: "core", kind: "note", task: taskId, text: `任务删除：${found.task.title ?? ""}` }]);
  });
  console.log(out.ok(`✅ 任务已删除：${taskId}（需求 ${found.reqId}）`));
  console.log(out.dim(`  · 剩 ${found.ledger.tasks.length - 1} 个任务；需求态由剩余任务派生`));
  return 0;
}

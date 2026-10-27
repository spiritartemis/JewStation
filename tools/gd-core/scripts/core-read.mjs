#!/usr/bin/env node
/**
 * core-read —— **core 层**的读面族（0.24.2 R-gm-083-01）
 *
 * 命令面（core 自足，不碰注册表 / 席位 / 引导 / git）：
 *   gd-core board [--events <n>] [--json]                       看板（4 态泳道 + 时间线）
 *   gd-core task list [--req <需求id>] [--status <s>]… [--todo] [--to-check] [--json]
 *   gd-core task show <任务id> [--req <需求id>] [--json]
 *   gd-core req status <需求id> [--json]
 *   gd-core milestone progress [<id|alias>] [--json]
 *
 * 为什么单独一族：0.24.1 把读面补到了完整 CLI（app 面）却没进 core 闭包 ⇒ 只装 `gd-core` 的宿主
 *   **画不了板、列不了任务、看不到进度**（包定位是「日常四步 + 结版」，读面全靠猜）。本族把这五个读命令
 *   收进分发件：取数与渲染在 `lib/board-read.mjs`（完整 CLI 与本族共用同一份，避免两处数字不一致）。
 *
 * 落点判定走 core 口径 `lib/board-account.mjs`：**只认板**（`GD_BOARD` / 本仓自举），无板即指路（不猜路径）；
 *   注册项目账属宿主面，core 面明确指路完整 CLI。
 */
import { parseArgs, rejectArgs, unknownFlags } from "./lib/args.mjs";
import { noBoardMessage, resolveBoardAccount } from "./lib/board-account.mjs";
import { boardView, boardReqStatusLines, buildBoardReqStatus, listBoardReqs, milestoneListPlan, milestoneProgressPlan, renderReqList, taskListLines, taskRowsOf, taskShowPlan } from "./lib/board-read.mjs";
import { TASK_STATES } from "./lib/board.mjs";
import { errOut } from "./lib/style.mjs";

/** core 面支持的子命令（其余属完整 CLI） */
export const BOARD_CORE_SUBCOMMANDS = ["board"];
export const TASK_READ_SUBCOMMANDS = ["list", "show"];
export const REQ_READ_SUBCOMMANDS = ["status", "list"];
export const MILESTONE_READ_SUBCOMMANDS = ["progress", "list"];

export const CORE_READ_USAGE = [
  "  gd-core board [--events <n>] [--json]",
  "  gd-core task list [--req <需求id>] [--status <ready|in_progress|review|done>]… [--todo | --to-check] [--json]",
  "  gd-core task show <任务id> [--req <需求id>] [--json]",
  "  gd-core req status <需求id> [--json]",
  "  gd-core req list [--version <x.y>] [--status <s>] [--kind <f|bug|chore>] [--severity <级别>] [--json]",
  "  gd-core milestone progress [<id|alias>] [--json]",
  "  gd-core milestone list [--json]",
  "  （落点：本仓的板 · 临时切板 export GD_BOARD=<板根目录>；注册项目账属完整 CLI）",
].join("\n");

/** 三族共用的「未知旗标」白名单外键 */
const ACCT_ALLOWED = ["board", "main-local", "json"];

const NEED_BOARD = (cmd, acct) => {
  console.error(errOut.err(noBoardMessage(cmd, acct)));
  return 1;
};

/** `gd-core board` —— 看板 */
export function runBoard(argv = []) {
  const args = parseArgs(argv);
  const unknown = unknownFlags(args, ["events", ...ACCT_ALLOWED], "core 面不认识");
  if (unknown.length > 0) return rejectArgs(unknown, CORE_READ_USAGE);
  const acct = resolveBoardAccount({ wantBoard: args.board === true });
  if (acct.mode === "none") return NEED_BOARD("gd-core board", acct);
  const eventLimit = Number(args.events ?? 10) || 0;
  const { boards, lines } = boardView({ root: acct.board.root, boardId: acct.board.id, boardName: acct.board.name ?? acct.board.id, eventLimit });
  if (args.json === true) {
    console.log(JSON.stringify({ ok: true, boards }, null, 2));
    return 0;
  }
  for (const line of lines) console.log(line);
  return 0;
}

/** `gd-core task list|show` */
export function runTaskRead(sub, argv = []) {
  const subName = String(sub ?? "");
  if (!TASK_READ_SUBCOMMANDS.includes(subName)) {
    console.error(errOut.err(`✗ core 面没有 "task ${subName}"（读面）。core 的 task 读面：${TASK_READ_SUBCOMMANDS.join(" / ")}；写面：task add`));
    console.error(`用法：\n${CORE_READ_USAGE}`);
    return 1;
  }
  if (subName === "list") {
    const args = parseArgs(argv, ["status"]);
    const unknown = unknownFlags(args, ["req", "status", "todo", "to-check", ...ACCT_ALLOWED], "core 面不认识");
    if (unknown.length > 0) return rejectArgs(unknown, CORE_READ_USAGE);
    const statuses = [];
    const raw = args.status;
    if (raw !== undefined) {
      for (const s of (Array.isArray(raw) ? raw : [raw]).flatMap((v) => (typeof v === "string" ? v.split(",").map((x) => x.trim()) : [v]))) {
        if (!TASK_STATES.includes(s)) {
          console.error(errOut.err(`✗ --status 取值非法："${s}"（允许：${TASK_STATES.join(" / ")}）`));
          return 1;
        }
        if (!statuses.includes(s)) statuses.push(s);
      }
    }
    if (args.todo === true) for (const s of ["ready", "in_progress"]) if (!statuses.includes(s)) statuses.push(s);
    if (args["to-check"] === true) if (!statuses.includes("review")) statuses.push("review");
    const acct = resolveBoardAccount({ wantBoard: args.board === true });
    if (acct.mode === "none") return NEED_BOARD("gd-core task list", acct);
    const board = acct.board;
    const reqId = typeof args.req === "string" ? args.req : null;
    let rows = taskRowsOf({ root: board.root, boardId: board.id, boardName: board.name ?? board.id, reqId });
    if (statuses.length > 0) rows = rows.filter((r) => statuses.includes(String(r.task.status)));
    if (args.json === true) {
      console.log(JSON.stringify({ ok: true, board: board.id, tasks: rows.map((r) => ({ ...r.task, req: r.reqId })) }, null, 2));
      return 0;
    }
    for (const line of taskListLines({ rows })) console.log(line);
    return 0;
  }
  // show
  const args = parseArgs(argv);
  const unknown = unknownFlags(args, ["req", ...ACCT_ALLOWED], "core 面不认识");
  if (unknown.length > 0) return rejectArgs(unknown, CORE_READ_USAGE);
  const taskId = typeof args._[0] === "string" ? args._[0] : "";
  if (!taskId) {
    console.error(errOut.err("✗ 缺少任务 id（gd-core task show <任务id> [--req <需求id>]）"));
    console.error(`用法：\n${CORE_READ_USAGE}`);
    return 1;
  }
  const acct = resolveBoardAccount({ wantBoard: args.board === true, id: taskId });
  if (acct.mode === "none") return NEED_BOARD("gd-core task show", acct);
  const board = acct.board;
  const plan = taskShowPlan({ root: board.root, boardId: board.id, boardName: board.name ?? board.id, taskId, reqId: typeof args.req === "string" ? args.req : null });
  if (!plan.ok) {
    console.error(errOut.err(`✗ ${plan.error}`));
    console.error("  排查：gd-core task list --todo（看待办）或 gd-core board（看板）");
    return 1;
  }
  if (args.json === true) {
    console.log(JSON.stringify(plan.payload, null, 2));
    return 0;
  }
  for (const line of plan.lines) console.log(line);
  return 0;
}

/** `gd-core req status` */
export function runReqRead(sub, argv = []) {
  const subName = String(sub ?? "");
  if (subName === "list") return reqList(argv);
  if (!REQ_READ_SUBCOMMANDS.includes(subName)) {
    console.error(errOut.err(`✗ core 面没有 "req ${subName}"（读面）。core 的 req 读面：${REQ_READ_SUBCOMMANDS.join(" / ")}；写面：req new`));
    console.error(`用法：\n${CORE_READ_USAGE}`);
    return 1;
  }
  const args = parseArgs(argv);
  const unknown = unknownFlags(args, ACCT_ALLOWED, "core 面不认识");
  if (unknown.length > 0) return rejectArgs(unknown, CORE_READ_USAGE);
  const reqId = typeof args._[0] === "string" ? args._[0] : "";
  if (!reqId) {
    console.error(errOut.err("✗ 缺少需求 id（gd-core req status <需求id>）"));
    console.error(`用法：\n${CORE_READ_USAGE}`);
    return 1;
  }
  const acct = resolveBoardAccount({ wantBoard: args.board === true, id: reqId });
  if (acct.mode === "none") return NEED_BOARD("gd-core req status", acct);
  const board = acct.board;
  const s = buildBoardReqStatus({ root: board.root, boardId: board.id, boardName: board.name ?? board.id }, reqId);
  if (!s) {
    console.error(errOut.err(`✗ 需求 "${reqId}" 不在板 ${board.id} 的账里（gd-core board 看板上有什么）`));
    return 1;
  }
  if (args.json === true) {
    console.log(JSON.stringify({ ok: true, board: board.id, req: s }, null, 2));
    return 0;
  }
  for (const line of boardReqStatusLines(s)) console.log(line);
  return 0;
}

/** `gd-core milestone progress` */
export function runMilestoneRead(sub, argv = []) {
  const subName = String(sub ?? "");
  if (subName === "list") return milestoneList(argv);
  if (!MILESTONE_READ_SUBCOMMANDS.includes(subName)) {
    console.error(errOut.err(`✗ core 面没有 "milestone ${subName}"（读面）。core 的 milestone 读面：${MILESTONE_READ_SUBCOMMANDS.join(" / ")}；写面：milestone add`));
    console.error(`用法：\n${CORE_READ_USAGE}`);
    return 1;
  }
  const args = parseArgs(argv);
  const unknown = unknownFlags(args, ACCT_ALLOWED, "core 面不认识");
  if (unknown.length > 0) return rejectArgs(unknown, CORE_READ_USAGE);
  const acct = resolveBoardAccount({ wantBoard: args.board === true });
  if (acct.mode === "none") return NEED_BOARD("gd-core milestone progress", acct);
  const board = acct.board;
  const want = typeof args._[0] === "string" ? args._[0] : null;
  const plan = milestoneProgressPlan({ root: board.root, boardId: board.id, want });
  if (!plan.ok) {
    console.error(errOut.err(`✗ ${plan.error}`));
    return 1;
  }
  if (args.json === true) {
    console.log(JSON.stringify(plan.payload, null, 2));
    return 0;
  }
  for (const line of plan.lines) console.log(line);
  return 0;
}

/** `gd-core req list` —— 板上需求清单（筛选与渲染同完整 CLI，单一实现） */
function reqList(argv = []) {
  const args = parseArgs(argv);
  const unknown = unknownFlags(args, [...ACCT_ALLOWED, "version", "status", "kind", "severity"], "core 面不认识");
  if (unknown.length > 0) return rejectArgs(unknown, CORE_READ_USAGE);
  const acct = resolveBoardAccount({ wantBoard: args.board === true });
  if (acct.mode === "none") return NEED_BOARD("gd-core req list", acct);
  const board = acct.board;
  // 旗标值归一：只认字串（漏写取值时 parseArgs 给 `true` ⇒ 当没给，与 `req new --subver` 同口径）
  const text = (v) => (typeof v === "string" ? v.trim() : null);
  const rows = listBoardReqs(board, { version: text(args.version), status: text(args.status), kind: text(args.kind), severity: text(args.severity) });
  if (args.json === true) {
    console.log(JSON.stringify({ ok: true, board: board.id, count: rows.length, reqs: rows }, null, 2));
    return 0;
  }
  renderReqList(rows);
  return 0;
}

/** `gd-core milestone list` —— 里程碑清单（时间线顺序 · 版号 · 关联需求进度） */
function milestoneList(argv = []) {
  const args = parseArgs(argv);
  const unknown = unknownFlags(args, ACCT_ALLOWED, "core 面不认识");
  if (unknown.length > 0) return rejectArgs(unknown, CORE_READ_USAGE);
  const acct = resolveBoardAccount({ wantBoard: args.board === true });
  if (acct.mode === "none") return NEED_BOARD("gd-core milestone list", acct);
  const board = acct.board;
  const plan = milestoneListPlan({ root: board.root });
  if (!plan.ok) {
    console.error(errOut.err(`✗ ${plan.error}`));
    return 1;
  }
  if (args.json === true) {
    console.log(JSON.stringify(plan.payload, null, 2));
    return 0;
  }
  for (const line of plan.lines) console.log(line);
  return 0;
}

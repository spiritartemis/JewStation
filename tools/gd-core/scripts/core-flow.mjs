/**
 * core-flow —— **core 层**的流转两族（0.23.0 R-gm-047-02/-03）
 *
 * 命令面（core 自足，不碰注册表 / 席位 / git）：
 *   gd-core handoff <任务id> [--req <需求id>] [--done "…"]… [--remain "…"]… [--decision "…"] [--next "…"]
 *                            [--text "…"] [--status in_progress|review] [--artifact <件路径>]… [--json]
 *   gd-core check <任务id> --pass | --reject "原因" [--req <需求id>] [--by <验收人>] [--note <结论>] [--json]
 *
 * 与完整 CLI 的关系：**同一份实现**（`lib/board-actions.mjs`），core 只少了注册项目账（需注册表）
 *   与收权闸门（app 侧）；状态机、事件、验收闸门、回显完全一致。
 *
 * 落点判定走 core 口径 `lib/board-account.mjs`：只认板（无板即指路），`--project` 当场指出属完整 CLI。
 */
import { parseArgs, rejectArgs, unknownFlags } from "./lib/args.mjs";
import { resolveBoardAccount, noBoardMessage } from "./lib/board-account.mjs";
import { HANDOFF_STATUSES, checkOnBoard, handoffOnBoard } from "./lib/board-actions.mjs";
import { printPlan } from "./lib/board-plans.mjs";
import { nowIso } from "./lib/board.mjs";
import { errOut } from "./lib/style.mjs";

const HANDOFF_USAGE = '  gd-core handoff <任务id> [--done "…"]… [--remain "…"]… [--decision "…"] [--next "…"] [--status in_progress|review] [--artifact <件路径>]… [--trace <决策trace_id>]… [--direct]';
const CHECK_USAGE = '  gd-core check <任务id> --pass | --reject "原因" [--by <验收人>] [--note <结论>] [--force] [--decision-overridden]';

const HANDOFF_ALLOWED = ["req", "done", "remain", "decision", "next", "text", "status", "artifact", "trace", "json", "board", "main-local", "direct"];
const CHECK_ALLOWED = ["pass", "reject", "req", "by", "note", "json", "board", "main-local", "force", "decision-overridden"];

const asList = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** `--project` 是 app 面（注册项目账）——core 明确指路，不静默忽略 */
function rejectProject(argv) {
  if (!argv.some((a) => a === "--project" || String(a).startsWith("--project="))) return false;
  const isCheck = argv.some((a) => a === "--pass" || String(a).startsWith("--reject"));
  console.error(errOut.err("✗ core 不写注册项目账（--project 需注册表，属完整 CLI）"));
  console.error(`  · 板账直接跑同一条命令（去掉 --project）；项目账：gd ${isCheck ? "check" : "handoff"} … --project <目录>`);
  return true;
}

/** `gd-core handoff <任务id>` */
export function runHandoff(argv = []) {
  if (rejectProject(argv)) return 1;
  const args = parseArgs(argv, ["done", "remain", "artifact"]);
  const errors = unknownFlags(args, HANDOFF_ALLOWED, "core 面不认识");
  const taskId = args._[0];
  if (!taskId) errors.push('缺少任务 id（gd-core handoff <任务id> …）');
  if (args._.length > 1) errors.push(`只接受一个任务 id（收到：${args._.join(" ")}）`);
  if (typeof args.status === "string" && !HANDOFF_STATUSES.includes(args.status)) {
    errors.push(`--status 非法："${args.status}"（可用：${HANDOFF_STATUSES.join(" / ")}；验收通过走 gd check <任务id> --pass）`);
  }
  const acct = resolveBoardAccount({ wantBoard: args.board === true, id: taskId });
  if (acct.mode === "none" && errors.length === 0) {
    console.error(errOut.err(noBoardMessage("gd-core handoff", acct)));
    return 1;
  }
  if (errors.length > 0) return rejectArgs(errors, HANDOFF_USAGE);
  return printPlan(
    handoffOnBoard({
      taskId,
      reqId: typeof args.req === "string" ? args.req : null,
      done: asList(args.done),
      remain: asList(args.remain),
      decision: typeof args.decision === "string" ? args.decision : null,
      next: typeof args.next === "string" ? args.next : null,
      text: typeof args.text === "string" ? args.text : null,
      status: typeof args.status === "string" ? args.status : null,
      artifacts: asList(args.artifact),
      traces: asList(args.trace), // 0.33.1：决策 trace 关联（验收时回填后验标签）
      direct: args.direct === true, // 0.47 B-gm-000022：越过工作单元闸门（直改主干，落事件留痕）
      json: args.json === true,
    }),
  );
}

/** `gd-core check <任务id> --pass | --reject "原因"` */
/** `gd-core check <任务id> --pass | --reject "原因"` */
export function runCheck(argv = []) {
  if (rejectProject(argv)) return 1;
  const args = parseArgs(argv);
  const taskId = args._[0];
  const pass = args.pass === true;
  const reject = typeof args.reject === "string" ? args.reject : args.reject === true ? "" : null;
  // `--by-user` 自己一条退役文案，不算「不认识」
  const errors = unknownFlags(args, [...CHECK_ALLOWED, "by-user"], "core 面不认识");
  if (args["by-user"] === true) errors.push("--by-user 已随任务验收收权退役（0.16.8）——验收人用 --by");
  if (!taskId) errors.push('缺少任务 id（gd-core check <任务id> --pass | --reject "原因"）');
  if (pass === (reject !== null)) errors.push('二选一：--pass（通过）或 --reject "原因"（打回）');
  if (reject !== null && reject.trim() === "") errors.push("--reject 必须带上打回原因（执行方据此返工）");
  if (errors.length > 0) return rejectArgs(errors, CHECK_USAGE);
  const acct = resolveBoardAccount({ wantBoard: args.board === true, id: taskId });
  if (acct.mode === "none") {
    console.error(errOut.err(noBoardMessage("gd-core check", acct)));
    return 1;
  }
  return printPlan(
    checkOnBoard({
      taskId,
      reqId: typeof args.req === "string" ? args.req : null,
      pass,
      reject,
      by: typeof args.by === "string" ? args.by : null,
      note: typeof args.note === "string" ? args.note : null,
      force: args.force === true,
      decisionOverridden: args["decision-overridden"] === true, // 0.33.1：只影响后验标签
      json: args.json === true,
      nowIso: nowIso(),
    }),
  );
}

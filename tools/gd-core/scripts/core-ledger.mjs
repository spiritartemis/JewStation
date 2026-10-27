/**
 * core-ledger —— **core 层**的登账三族（0.23.0 R-gm-046-02）
 *
 * 命令面（core 自足，不碰注册表 / 席位 / git）：
 *   gd-core milestone add "<名称>" --target <YYYY-MM-DD> [--status planned|in_progress] [--alias <意涵缩写>] [--series <字母>] [--note "…"]
 *   gd-core req new "<标题>" [--line <开发线段>] [--ver <x.y>] [--summary "…"] [--subver x.y.z] [--kind feature|bug|chore] [--severity …] [--found-in …] [--affects …]
 *   gd-core task add <需求id> --task "[执行体id:]标题" …
 *
 * 与完整 CLI 的关系：**同一份经营流程**（`lib/board-plans.mjs`），core 只少了两样宿主能力——
 *   ① 注册项目账（`--project`，需注册表）② 写后自动提交 / 推送（`git`）。其余判据（版本线闸门 / 缺陷口径 /
 *   子版号递增 / 接棒）与完整 CLI 完全一致，回显也一致（同一组 lines）。
 *
 * 落点判定走 core 口径 `lib/board-account.mjs`：只认板，无板即 `none` 并指路（不猜路径）。
 */
import { parseArgs, rejectArgs, unknownFlags } from "./lib/args.mjs";
import { resolveBoardAccount, noBoardMessage } from "./lib/board-account.mjs";
import { buildMilestoneAdd, defectFieldsOf, milestoneWrittenLines, parseTaskSpecs, prepareMilestoneWrite, printPlan, reqNewOnBoard, taskAddOnBoard, writeMilestoneList } from "./lib/board-plans.mjs";
import { readMilestones } from "./lib/milestones.mjs";
import { out, errOut } from "./lib/style.mjs";

export const MILESTONE_CORE_SUBCOMMANDS = ["add"];
export const REQ_CORE_SUBCOMMANDS = ["new"];
export const TASK_CORE_SUBCOMMANDS = ["add"];

const USAGE = [
  "  gd-core milestone add \"<名称>\" --target <YYYY-MM-DD> [--status planned|in_progress] [--alias <意涵缩写>] [--series <字母>] [--req <需求id>]… [--note \"…\"]",
  "  gd-core req new \"<标题>\" [--ver <x.y>] [--summary \"…\"] [--subver x.y.z] [--kind feature|bug|chore] [--severity blocker|major|minor] [--found-in <版本>] [--affects <版本,…>] [--force]",
  "  gd-core task add <需求id> --task \"[执行体id:]标题\"… [--force]",
  "  （落点：本仓的板 · 临时切板 export GD_BOARD=<板根目录>；注册项目账 / 写后提交属完整 CLI）",
].join("\n");

/** 三族共用的「未知旗标」白名单外键（写错就拒，不静默忽略） */
const ACCT_ALLOWED = ["board", "main-local"];

/** `gd-core milestone …` */
export function runMilestone(sub, argv = []) {
  const args = parseArgs(argv, ["req"]);
  const unknown = unknownFlags(args, ["target", "status", "alias", "series", "req", "note", ...ACCT_ALLOWED], "core 面不认识");
  if (unknown.length > 0) return rejectArgs(unknown, USAGE);
  const acct = resolveBoardAccount({ wantBoard: args.board === true });
  if (acct.mode === "none") {
    console.error(errOut.err(noBoardMessage("gd-core milestone add", acct)));
    return 1;
  }
  const board = acct.board;
  const r = readMilestones(board.root);
  if (!r.ok) {
    console.error(errOut.err(`✗ <板根>/milestones.yaml 读取失败：${r.error}`));
    return 1;
  }
  const name = typeof args._[0] === "string" ? args._[0] : "";
  const built = buildMilestoneAdd({
    list: r.list,
    name,
    target: typeof args.target === "string" ? args.target : null,
    status: typeof args.status === "string" ? args.status : null,
    alias: typeof args.alias === "string" ? args.alias : null,
    series: typeof args.series === "string" ? args.series : null,
    note: typeof args.note === "string" ? args.note : "",
    // --req 可重复（数组）/ 单个（字串）/ 未给 —— 统一成字串数组（未给时 [undefined] 会被滤掉）
    reqs: (Array.isArray(args.req) ? args.req : [args.req]).filter((x) => typeof x === "string"),
  });
  if (!built.ok) return printPlan(built);
  const prep = prepareMilestoneWrite({ projDir: board.root, list: built.list });
  if (!prep.ok) return printPlan(prep);
  const m = built.milestone;
  try {
    writeMilestoneList({ projDir: board.root, list: prep.list });
  } catch (e) {
    console.error(errOut.err(`✗ 里程碑账写入失败：${e.message}`));
    return 1;
  }
  return printPlan({
    ok: true,
    lines: [...milestoneWrittenLines({ action: `新增里程碑 ${m.id}`, summary: `${m.name}（目标 ${m.target}）`, view: prep.view, baton: prep.baton }), out.dim(`  账在板上（${board.root}/milestones.yaml，不入提交）：关联需求 gd-core … · 结版须用户确认`)],
  });
}

/** `gd-core req new` */
export function runReq(sub, argv = []) {
  const args = parseArgs(argv);
  const unknown = unknownFlags(args, ["summary", "ver", "line", "subver", "kind", "severity", "found-in", "affects", "needs", "force", ...ACCT_ALLOWED], "core 面不认识");
  if (unknown.length > 0) return rejectArgs(unknown, USAGE);
  const title = typeof args._[0] === "string" ? args._[0] : null;
  if (!title) {
    console.error(errOut.err("✗ 参数校验未通过："));
    console.error('  · 缺少需求标题（gd-core req new "标题"）');
    console.error(`用法：\n${USAGE}`);
    return 1;
  }
  if (args._.length > 1) {
    console.error(errOut.err("✗ 参数校验未通过："));
    console.error(`  · 只接受一个位置参数（标题），收到：${args._.join(" ")}`);
    return 1;
  }
  const acct = resolveBoardAccount({ wantBoard: args.board === true });
  if (acct.mode === "none") {
    console.error(errOut.err(noBoardMessage("gd-core req new", acct)));
    return 1;
  }
  return printPlan(
    reqNewOnBoard({
      board: acct.board,
      title,
      summary: typeof args.summary === "string" ? args.summary : "",
      ver: typeof args.ver === "string" ? args.ver : null,
      line: typeof args.line === "string" ? args.line : null,
      subver: typeof args.subver === "string" ? args.subver : null,
      needs: args.needs === undefined ? null : Array.isArray(args.needs) ? args.needs : [args.needs],
      defect: defectFieldsOf(args),
      force: args.force === true,
    }),
  );
}

/** `gd-core task add` */
export function runTask(sub, argv = []) {
  const args = parseArgs(argv, ["task"]);
  const unknown = unknownFlags(args, ["task", "force", ...ACCT_ALLOWED], "core 面不认识");
  if (unknown.length > 0) return rejectArgs(unknown, USAGE);
  const reqId = typeof args._[0] === "string" ? args._[0] : null;
  const { parsed, errors } = parseTaskSpecs(args.task);
  if (!reqId) errors.unshift('缺少需求 id（gd-core task add <需求id> --task "标题" …）');
  if (errors.length > 0) {
    console.error(errOut.err("✗ 参数校验未通过："));
    for (const e of errors) console.error(`  · ${e}`);
    console.error(`用法：\n${USAGE}`);
    return 1;
  }
  const acct = resolveBoardAccount({ wantBoard: args.board === true, id: reqId });
  if (acct.mode === "none") {
    console.error(errOut.err(noBoardMessage("gd-core task add", acct)));
    return 1;
  }
  return printPlan(taskAddOnBoard({ board: acct.board, reqId, tasks: parsed, force: args.force === true }));
}


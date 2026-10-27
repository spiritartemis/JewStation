/**
 * core-vers —— **core 层**的子版结版族（0.23.1 R-gm-048）
 *
 * 命令面（core 自足，不碰注册表 / 席位 / git）：
 *   gd-core ver list [--json]
 *   gd-core ver reach <x.y.z> --confirm <x.y.z> [--on <YYYY-MM-DD>] [--note "…"] [--force]
 *   gd-core ver reopen <x.y.z> --confirm <x.y.z> --reason "…"
 *   gd-core ver claim <x.y> [--as <名字>] [--note "…"] [--force]
 *   gd-core ver release <x.y> [--as <名字>] [--force]
 *   gd-core ver lanes [--json]
 *
 * 与完整 CLI 的关系：**同一份判据与回显**（`lib/board-vers.mjs`），core 只是没有「注册项目账 / 写后提交」这两样
 * 宿主能力——结版这件事本身不写工作区文件，所以能整套下沉。铁律闸门（`--confirm` 点名）也随之下沉：
 * 装出去的那套装了 core CLI 就能结版，且**照样**拦「没点名就结版」。
 *
 * 落点判定走 core 口径 `lib/board-account.mjs`：只认板，无板即指路（不猜路径）。
 */
import { parseArgs, rejectArgs, unknownFlags } from "./lib/args.mjs";
import { noBoardMessage, resolveBoardAccount } from "./lib/board-account.mjs";
import { checkReachArgs, checkReopenArgs, checkVersionArg, VER_SUB_FLAGS, VER_USAGE, verClaimPlan, verLanesPlan, verListPlan, verReopenPlan, verReleasePlan, verReachPlan } from "./lib/board-vers.mjs";
import { printPlan } from "./lib/board-plans.mjs";
import { errOut } from "./lib/style.mjs";

/** core 面支持的 `ver` 子命令（其余属完整 CLI） */
export const VER_CORE_SUBCOMMANDS = ["list", "reach", "reopen", "claim", "release", "lanes"];

const CORE_USAGE = ["  gd-core ver list [--json]", ...VER_USAGE.split("\n").filter((l) => l.includes("reach") || l.includes("reopen"))].join("\n");

/** `gd-core ver <sub> …` */
export function runVer(sub, argv = []) {
  const subName = String(sub ?? "");
  if (!VER_CORE_SUBCOMMANDS.includes(subName)) {
    console.error(errOut.err(`✗ core 面没有 "ver ${subName}"。core 提供：${VER_CORE_SUBCOMMANDS.join(" / ")}`));
    console.error(`用法：\n${CORE_USAGE}`);
    return 1;
  }
  const args = parseArgs(argv);
  const unknown = unknownFlags(args, ["board", ...(VER_SUB_FLAGS[subName] ?? [])], "core 面不认识");
  if (unknown.length > 0) return rejectArgs(unknown, CORE_USAGE);
  const acct = resolveBoardAccount({ wantBoard: args.board === true });
  if (acct.mode === "none") {
    console.error(errOut.err(noBoardMessage(`gd-core ver ${subName}`, acct)));
    return 1;
  }
  const board = acct.board;
  if (subName === "list") return printPlan(verListPlan({ board, json: args.json === true }));
  const alias = typeof args._[0] === "string" ? args._[0] : "";
  const on = typeof args.on === "string" ? args.on : null; // `--on` 不带值 ⇒ null（缺省今天）
  const note = typeof args.note === "string" ? args.note : "";
  const confirm = args.confirm ?? null;
  if (subName === "reach") {
    const gate = checkReachArgs({ alias, on: args.on ?? null, confirm });
    if (gate) return printPlan(gate);
    return printPlan(verReachPlan({ board, alias, on, note, force: args.force === true, json: args.json === true }));
  }
  if (subName === "reopen") {
    const gate = checkReopenArgs({ alias, reason: args.reason ?? "", confirm });
    if (gate) return printPlan(gate);
    return printPlan(verReopenPlan({ board, alias, reason: String(args.reason ?? ""), json: args.json === true }));
  }
  if (subName === "lanes") return printPlan(verLanesPlan({ board, json: args.json === true }));
  // claim / release：版本号（x.y）闸门
  const vGate = checkVersionArg(alias);
  if (vGate) return printPlan(vGate);
  const common = { board, version: alias, as: typeof args.as === "string" ? args.as : "", force: args.force === true, json: args.json === true };
  if (subName === "claim") return printPlan(verClaimPlan({ ...common, note }));
  return printPlan(verReleasePlan(common));
}

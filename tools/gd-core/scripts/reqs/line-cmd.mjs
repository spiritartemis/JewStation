/**
 * `gd line …` —— **开发线认领**（两轴模型 · 开发轴）
 *
 * 命令面：
 *   gd line claim <线号> [--as <名字>] [--note "…"] [--force]
 *   gd line release <线号> [--as <名字>] [--force]
 *   gd line list [--json]
 *
 * 线号 = 里程碑（开发线）id 去 `m-` 前缀（`m-1a` ⇒ `1a`）。
 * 语义与 `gd ver claim` 同构（软隔离 + `--force` 越过并留痕），只是坐标换成了开发线。
 */
import { parseArgs, rejectArgs, unknownFlags } from "../lib/args.mjs";
import { noBoardMessage, resolveBoardAccount } from "../lib/board-account.mjs";
import { lineClaimPlan, lineListPlan, lineReleasePlan } from "../lib/board-lines.mjs";
import { printPlan } from "../lib/board-plans.mjs";
import { errOut } from "../lib/style.mjs";

export const LINE_SUBCOMMANDS = ["claim", "release", "list"];

export const LINE_SUB_FLAGS = {
  claim: ["as", "note", "force", "json", "board", "main-local"],
  release: ["as", "force", "json", "board", "main-local"],
  list: ["json", "board", "main-local"],
};

const USAGE = [
  "  gd line claim <线号> [--as <名字>] [--note \"…\"] [--force]",
  "  gd line release <线号> [--as <名字>] [--force]",
  "  gd line list [--json]",
].join("\n");

/** `gd line <sub> …` */
export function runLine(sub, argv = []) {
  const subName = String(sub ?? "");
  if (!LINE_SUBCOMMANDS.includes(subName)) {
    console.error(errOut.err(`✗ 未知子命令 "line ${subName}"。可用：${LINE_SUBCOMMANDS.join(" / ")}`));
    console.error(`用法：\n${USAGE}`);
    return 1;
  }
  const args = parseArgs(argv);
  const unknown = unknownFlags(args, LINE_SUB_FLAGS[subName] ?? [], "line 面不认识");
  if (unknown.length > 0) return rejectArgs(unknown, USAGE);
  const acct = resolveBoardAccount({ wantBoard: args.board === true });
  if (acct.mode === "none") {
    console.error(errOut.err(noBoardMessage(`gd line ${subName}`, acct)));
    return 1;
  }
  const { board } = acct;
  const json = args.json === true;
  const as = typeof args.as === "string" ? args.as : "";
  const force = args.force === true;
  const target = String(args._[0] ?? "").trim();
  if (subName !== "list" && target === "") {
    console.error(errOut.err(`✗ 缺开发线号（用法：\n${USAGE}）`));
    return 1;
  }
  const plan =
    subName === "claim"
      ? lineClaimPlan({ board, line: target, as, note: typeof args.note === "string" ? args.note : "", force, json })
      : subName === "release"
        ? lineReleasePlan({ board, line: target, as, force, json })
        : lineListPlan({ board, json });
  if (json && plan.json) console.log(JSON.stringify(plan.json, null, 2));
  else for (const line of plan.lines ?? []) (plan.ok ? console.log : console.error)(line);
  if (!plan.ok && !json) console.error(errOut.err(noBoardMessage()));
  return plan.ok ? 0 : (plan.code ?? 1);
}

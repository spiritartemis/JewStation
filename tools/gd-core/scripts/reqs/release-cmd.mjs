/**
 * `gd release …` —— **发版账**（两轴模型 · 发布轴）+ 既有「版本归档」入口
 *
 * 发版账命令面（版本坐标只在这里产生）：
 *   gd release new "<名称>" [--version <x.y>] [--note "…"] [--json]
 *   gd release list [--json]
 *   gd release show <x.y> [--json]
 *   gd release add <x.y> --req <需求id>… [--json]
 *   gd release freeze <x.y> --evidence "<回归证据>" [--json]
 *   gd release tag <x.y> --tag <tag> [--json]
 *
 * 既有：`gd release archive <版本号>`（版本归档三同步 · 文档搬运）—— 保留原样。
 */
import { parseArgs, rejectArgs, unknownFlags } from "../lib/args.mjs";
import { noBoardMessage, resolveBoardAccount } from "../lib/board-account.mjs";
import { releaseAddPlan, releaseFreezePlan, releaseListPlan, releaseNewPlan, releaseShowPlan, releaseTagPlan } from "../lib/board-ship.mjs";
import { printPlan } from "../lib/board-plans.mjs";
import { errOut } from "../lib/style.mjs";

export const RELEASE_SUBCOMMANDS = ["new", "list", "show", "add", "freeze", "tag"];

export const RELEASE_SUB_FLAGS = {
  new: ["version", "note", "json", "board", "main-local"],
  list: ["json", "board", "main-local"],
  show: ["json", "board", "main-local"],
  add: ["req", "json", "board", "main-local"],
  freeze: ["evidence", "json", "board", "main-local"],
  tag: ["tag", "json", "board", "main-local"],
};

const USAGE = [
  '  gd release new "<名称>" [--version <x.y>] [--note "…"]',
  "  gd release list [--json]",
  "  gd release show <x.y> [--json]",
  "  gd release add <x.y> --req <需求id>…",
  '  gd release freeze <x.y> --evidence "<回归证据>"',
  "  gd release tag <x.y> --tag <tag>",
].join("\n");

/** `gd release <sub> …`（发版账子命令；`archive` 由上层另行路由） */
export function runReleaseCmd(sub, argv = []) {
  const subName = String(sub ?? "");
  if (!RELEASE_SUBCOMMANDS.includes(subName)) {
    console.error(errOut.err(`✗ 未知子命令 "release ${subName}"。可用：${RELEASE_SUBCOMMANDS.join(" / ")} · archive（版本归档）`));
    console.error(`用法：\n${USAGE}`);
    return 1;
  }
  // `--req` 可重复（一次收多条需求）⇒ 声明为 multiKey，否则只留下最后一个值
  const args = parseArgs(argv, ["req"]);
  const unknown = unknownFlags(args, RELEASE_SUB_FLAGS[subName] ?? [], "release 面不认识");
  if (unknown.length > 0) return rejectArgs(unknown, USAGE);
  const acct = resolveBoardAccount({ wantBoard: args.board === true });
  if (acct.mode === "none") {
    console.error(errOut.err(noBoardMessage(`gd release ${subName}`, acct)));
    return 1;
  }
  const { board } = acct;
  const json = args.json === true;
  const target = String(args._[0] ?? "").trim();
  const name = String(args._[0] ?? "").trim();
  const reqs = Array.isArray(args.req) ? args.req : args.req !== undefined ? [args.req] : [];
  if (["show", "add", "freeze", "tag"].includes(subName) && target === "") {
    console.error(errOut.err(`✗ 缺版本号（用法：\n${USAGE}）`));
    return 1;
  }
  const plan =
    subName === "new"
      ? releaseNewPlan({ board, name, version: typeof args.version === "string" ? args.version : "", note: typeof args.note === "string" ? args.note : "", json })
      : subName === "list"
        ? releaseListPlan({ board, json })
        : subName === "show"
          ? releaseShowPlan({ board, version: target, json })
          : subName === "add"
            ? releaseAddPlan({ board, version: target, reqs, json })
            : subName === "freeze"
              ? releaseFreezePlan({ board, version: target, evidence: typeof args.evidence === "string" ? args.evidence : "", json })
              : releaseTagPlan({ board, version: target, tag: typeof args.tag === "string" ? args.tag : "", json });
  if (json && plan.json) console.log(JSON.stringify(plan.json, null, 2));
  else for (const line of plan.lines ?? []) (plan.ok ? console.log : console.error)(line);
  return plan.ok ? 0 : (plan.code ?? 1);
}

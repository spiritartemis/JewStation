#!/usr/bin/env node
/**
 * core-brief —— **进度简报**（core 层 · 只读 · 0.49.1 R-gm-49-1）
 *
 * 命令面：
 *   gd-core brief [--json] [--full] [--section <coords|map|recent|next|drift>] [--no-git]
 *
 * 定位：**开工前的第一条命令**。一次取数出五段（坐标 / 鸟瞰 / 下一步 / 漂移 / 上次），
 *   替代原来「gd core status + milestone list + board + req list + task list + 手读账 yaml」那一串。
 *   口径与判据全部收在 `lib/brief.mjs`（本文件只管参数与出口，不含业务判断）。
 *
 * 三条边界（与 lib 同源，写在命令面上是为了「跑之前就知道」）：
 *   · **零写**：不写账、不改文件；`roadmap.md` 之类的派生视图也不会被重算落盘。
 *   · **不跑门禁**：门禁属收工面，简报既不替你跑、也不在输出里代为点名。
 *   · **只认板**：注册项目账属完整 CLI（brief 的语义是「本仓的板在哪」，没有项目账版本）。
 */
import { parseArgs, rejectArgs, unknownFlags } from "./lib/args.mjs";
import { noBoardMessage, resolveBoardAccount } from "./lib/board-account.mjs";
import { BRIEF_SECTIONS, buildBrief, JSON_BUDGET, renderBrief } from "./lib/brief.mjs";
import { errOut, out } from "./lib/style.mjs";

export const BRIEF_USAGE = [
  "  gd-core brief [--json] [--full] [--section <名>] [--no-git]      进度简报（只读 · 一次取数出五段）",
  `    --section  单取一段：${BRIEF_SECTIONS.join(" / ")}`,
  "    --full     展开已达成里程碑的需求明细（缺省折叠成「done/total」三个数）",
  "    --no-git   不跑 git（不报未推送 / 未提交；无 git 的宿主用）",
  "  （落点：本仓的板 · 临时切板 export GD_BOARD=<板根目录>）",
].join("\n");

const ALLOWED = ["json", "full", "section", "no-git", "board", "main-local"];

/**
 * `gd-core brief`
 * @param {string[]} argv
 */
export function runBrief(argv = []) {
  const args = parseArgs(argv, ["section"]);
  const errors = unknownFlags(args, ALLOWED, "core 面不认识");
  const sections = args.section === undefined ? BRIEF_SECTIONS : Array.isArray(args.section) ? args.section : [args.section];
  for (const s of sections) {
    if (!BRIEF_SECTIONS.includes(String(s))) errors.push(`--section 非法："${s}"（可用：${BRIEF_SECTIONS.join(" / ")}）`);
  }
  if (args._.length > 0) errors.push(`brief 不接受位置参数（收到：${args._.join(" ")}；要看某条需求：gd req status <id>）`);
  if (errors.length > 0) return rejectArgs(errors, BRIEF_USAGE);

  const acct = resolveBoardAccount({ wantBoard: args.board === true });
  if (acct.mode === "none") {
    console.error(errOut.err(noBoardMessage("gd-core brief", acct)));
    return 1;
  }
  const { payload } = buildBrief({
    root: acct.board.root,
    board: acct.board,
    full: args.full === true,
    git: args["no-git"] !== true,
    sections,
  });
  if (args.json === true) {
    const body = JSON.stringify(payload, null, 2);
    if (Buffer.byteLength(body) > JSON_BUDGET) {
      // 不静默超预算：少取段是消费者的选择，撑爆上下文不是
      console.error(errOut.err(`✗ brief JSON 超预算（${Buffer.byteLength(body)} > ${JSON_BUDGET} 字节）`));
      console.error(`  · 单取一段：gd-core brief --json --section ${BRIEF_SECTIONS.join(" / --section ")}`);
      return 1;
    }
    console.log(body);
    return 0;
  }
  for (const line of renderBrief(payload, { full: args.full === true })) console.log(line);
  return 0;
}

/** 自述帮助（`gd-core brief --help` 与 core 入口的 help 段共用） */
export function briefHelp() {
  console.log(out.ok("gd-core brief — 进度简报（只读）"));
  console.log(BRIEF_USAGE);
}

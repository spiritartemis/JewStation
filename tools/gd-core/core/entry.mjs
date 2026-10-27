#!/usr/bin/env node
/**
 * gd-core 入口（core 层自包含 CLI · 0.19.0 R-gm-005 · 0.23.1 以 skill 取代 guide）
 *
 * 这是**真正自包含**的入口：它的静态闭包只包含 core 层模块（闭包由 `scripts/core-closure-check.mjs`
 *   现算并机器守护；清单副本只随产物分发，仓库不跟踪）——没有席位、没有工作站、没有注册表、没有 `.pi`。
 *
 * 命令面（core 层自有）：
 *   gd-core core init|status|roadmap        板自举与派生视图
 *   gd-core work claim|release|list|start|submit|land   会话认领与并发隔离
 *   gd-core milestone add|update|reach|reopen|remove   里程碑写面（结版 / 退档须 --confirm 点名）
 *   gd-core req new|update|delete                      需求写面（--ver 走新口径 id）
 *   gd-core task add                       拆任务（同上）
 *   gd-core ver list|reach|reopen|claim|release|lanes   结版与版本线（0.23.1 R-gm-048 · 铁律闸门 --confirm 随包）
 *   gd-core handoff|check <任务id>          交件 / 验收（0.23.0 R-gm-047）
 *   gd-core milestone update|reach|reopen|remove   里程碑管理面（结版 / 退档须 --confirm 点名）
 *   gd-core req update|delete                     需求管理面（纠错 / 作废）
 *   gd-core task update|delete                    任务管理面（改标题 / 补 input / 纠错）
 *   gd-core board | task list|show | req list|status | milestone list|progress   读面（0.24.2 R-gm-083）
 *   gd-core skill install|path|print        会话工作法 skill 的安装与查看（0.23.1 R-gm-075 取代 guide）
 *
 * 其余命令（req apply 方案落盘 · task gen 批量拆活 · 席位面 gd seat * · 注册项目账）在**完整 CLI**里，
 *   它们要处理「注册项目」/ 自动提交 / 席位这类宿主上下文；core 入口只给一句明确指路，不假装支持。
 *   ⇒ core-only 机器走完整闭环靠 `task add` 逐个建任务，不需方案文件。
 */
import { readFileSync } from "node:fs";
import { runCore, CORE_SUBCOMMANDS } from "../scripts/core-init.mjs";
import { runSkill, SKILL_SUBCOMMANDS } from "../scripts/core-skill.mjs";
import { runWork, WORK_SUBCOMMANDS } from "../scripts/work.mjs";
import { MILESTONE_CORE_SUBCOMMANDS, REQ_CORE_SUBCOMMANDS, TASK_CORE_SUBCOMMANDS, runMilestone, runReq, runTask } from "../scripts/core-ledger.mjs";
import { MILESTONE_MANAGE_SUBCOMMANDS, REQ_MANAGE_SUBCOMMANDS, TASK_MANAGE_SUBCOMMANDS, runMilestoneManage, runReqManage, runTaskManage } from "../scripts/core-manage.mjs";
import { runCheck, runHandoff } from "../scripts/core-flow.mjs";
import { VER_CORE_SUBCOMMANDS, runVer } from "../scripts/core-vers.mjs";
import { BOARD_CORE_SUBCOMMANDS, MILESTONE_READ_SUBCOMMANDS, REQ_READ_SUBCOMMANDS, TASK_READ_SUBCOMMANDS, runBoard, runMilestoneRead, runReqRead, runTaskRead } from "../scripts/core-read.mjs";
import { runBrief, BRIEF_USAGE } from "../scripts/core-brief.mjs"; // 0.49.1 R-gm-49-1：进度简报（开工前第一条命令）
import { CAP_CORE_SUBCOMMANDS, runCapCore } from "../scripts/core-cap.mjs"; // 0.61 R-gm-61-0：能力层（板账 capabilities/）

/** 版本自证：读同级 package.json（仓内 = 壳模板占位 0.0.0；装配件 = core-pack 注入的真版本） */
function versionLine() {
  try {
    const pkg = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));
    const dev = pkg.version === "0.0.0" ? "（仓内开发态 · 版本随装配注入）" : "";
    return `${pkg.name ?? "gd-core"} ${pkg.version ?? "0.0.0"}${dev}`;
  } catch {
    return "gd-core 版本未知（读不到 package.json）";
  }
}

/** 自述帮助：`gd-core`、`gd-core help`、`gd-core --help` 同一出口 */
const HELP = `gd-core — 会话级核心工作流（板 / 三层账 / 认领 / 并发隔离）

用法：
  gd-core --version                        # 版本自证（本包 package.json）
  gd-core core init [--board-dir <路径>|--in-tree] [--id <板id>] [--tag <tag>|--no-tag] [--force] [--dry-run] [--json]
  gd-core core status [--json]
  gd-core brief [--json] [--full] [--section <名>] [--no-git]          进度简报（只读·五段：坐标/鸟瞰/下一步/漂移/上次）
  gd-core cap new|list|show|update|req|fulfill|history|bind|draft|merge|export|import  能力层（板账 capabilities/）：立能力 / 判据写面（req）/ 兑现（fulfill）/ 挂点（bind）/ 影响面与草稿（draft）/ delta 合入（merge）/ 视图进出（export|import）
  gd-core core roadmap [--write] [--out <文件>] [--json]
  gd-core skill install [--dir <目录>] [--force]   # 装会话工作法 skill 到 <仓根>/.pi/skills/gd-core
  gd-core skill path|print [--json]                # 源/目标目录 · 打印 SKILL.md
  gd-core work claim <任务id> [--executor <名册id>] [--ttl <分钟>] [--json]
  gd-core work release <任务id> [--force] [--json]
  gd-core work list [--json]
  gd-core work start <任务id> [--base <ref>] [--worktree-dir <目录>] [--json]
  gd-core work submit <任务id> [--message "<提交信息>"] [--json]
  gd-core work land <任务id> [--keep] [--json]
  gd-core milestone add "<名称>" --target <YYYY-MM-DD> [--status planned|in_progress] [--alias <意涵缩写>] [--ver-from <x.y> --ver-to <x.y>] [--req <需求id>]… [--note "…"]
  gd-core milestone update <id> [--name|--target|--status|--on|--alias|--ver-from|--ver-to|--req-add|--req-remove|--note]
  gd-core milestone reach <id> --confirm <id> [--on <YYYY-MM-DD>]      达成（铁律：须点名）
  gd-core milestone reopen <id> --confirm <id>                        退档（撤销达成）
  gd-core milestone remove <id>
  gd-core req new "<标题>" [--ver <x.y>] [--summary "…"] [--subver x.y.z] [--kind feature|bug|chore] [--severity …] [--found-in <版本>] [--affects …] [--force]
  gd-core req update <需求id> [--title|--summary|--kind|--severity|--found-in|--affects|--subver]
  gd-core req delete <需求id> [--force]
  gd-core task add <需求id> --task "[执行体id:]标题"… [--force]
  gd-core task update <任务id> [--title|--input|--executor] [--req <需求id>]
  gd-core task delete <任务id> [--req <需求id>]
  gd-core ver list [--json]
  gd-core ver reach <x.y.z> --confirm <x.y.z> [--on <YYYY-MM-DD>] [--note "…"] [--force]   结版（铁律：须点名）
  gd-core ver reopen <x.y.z> --confirm <x.y.z> --reason "…"                               撤销结版（须点名 + 理由）
  gd-core board [--events <n>] [--json]                                看板（4 态泳道 + 时间线）
  gd-core task list [--req <需求id>] [--status <s>]… [--todo | --to-check] [--json]
  gd-core task show <任务id> [--req <需求id>] [--json]
  gd-core req status <需求id> [--json]
  gd-core req list [--version <x.y>] [--status <s>] [--kind <k>] [--severity <级别>] [--json]
  gd-core milestone progress [<id|alias>] [--json]
  gd-core milestone list [--json]
  gd-core handoff <任务id> [--done "…"]… [--remain "…"]… [--decision "…"] [--next "…"] [--status in_progress|review] [--artifact <件>]… [--json]
  gd-core check <任务id> --pass | --reject "原因" [--by <验收人>] [--note <结论>] [--json]

装工作法 skill：gd-core skill install   # SKILL.md（路由 + 铁律）+ references（按需读）
其余命令（req apply 方案落盘 · task gen 批量拆活 · 席位面 gd seat * · 注册项目账）属完整 CLI：需装总控或用 GD_MAIN_LOCAL 指路。
core-only 也能走完整闭环：拆活用 task add 逐个建即可。`;

/** 命令族：族 → 子命令清单与运行器 */
const FAMILIES = {
  core: { subs: CORE_SUBCOMMANDS, hint: "core init|status|roadmap", run: runCore },
  skill: { subs: SKILL_SUBCOMMANDS, hint: "skill install|path|print", run: runSkill },
  work: { subs: WORK_SUBCOMMANDS, hint: "work claim|release|list|start|submit|land", run: runWork },
  board: { subs: BOARD_CORE_SUBCOMMANDS, hint: "board", run: (_sub, argv) => runBoard(argv) },
  milestone: {
    subs: [...MILESTONE_CORE_SUBCOMMANDS, ...MILESTONE_MANAGE_SUBCOMMANDS, ...MILESTONE_READ_SUBCOMMANDS],
    hint: "milestone add|update|reach|reopen|remove|list|progress",
    run: (sub, argv) => {
      if (MILESTONE_READ_SUBCOMMANDS.includes(sub)) return runMilestoneRead(sub, argv);
      if (MILESTONE_MANAGE_SUBCOMMANDS.includes(sub)) return runMilestoneManage(sub, argv);
      return runMilestone(sub, argv);
    },
  },
  req: {
    subs: [...REQ_CORE_SUBCOMMANDS, ...REQ_MANAGE_SUBCOMMANDS, ...REQ_READ_SUBCOMMANDS],
    hint: "req new|update|delete|list|status",
    run: (sub, argv) => {
      if (REQ_READ_SUBCOMMANDS.includes(sub)) return runReqRead(sub, argv);
      if (REQ_MANAGE_SUBCOMMANDS.includes(sub)) return runReqManage(sub, argv);
      return runReq(sub, argv);
    },
  },
  task: {
    subs: [...TASK_CORE_SUBCOMMANDS, ...TASK_MANAGE_SUBCOMMANDS, ...TASK_READ_SUBCOMMANDS],
    hint: "task add|update|delete|list|show",
    run: (sub, argv) => {
      if (TASK_READ_SUBCOMMANDS.includes(sub)) return runTaskRead(sub, argv);
      if (TASK_MANAGE_SUBCOMMANDS.includes(sub)) return runTaskManage(sub, argv);
      return runTask(sub, argv);
    },
  },
  ver: { subs: VER_CORE_SUBCOMMANDS, hint: "ver list|reach|reopen", run: runVer },
  cap: { subs: CAP_CORE_SUBCOMMANDS, hint: "cap new|list|show|update|req|fulfill|history|bind|draft|merge|export|import", run: runCapCore },
};

const [cmd, sub, ...rest] = process.argv.slice(2);

// 版本自证（须在 help 分支之前，否则被自述吞掉）
if (cmd === "--version" || cmd === "-v" || cmd === "version") {
  console.log(versionLine());
  process.exit(0);
}

// 无参 / help / --help 一律打自述（不再当成"未知 app 族"报错）
if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  console.log(HELP);
  process.exit(0);
}

// board / brief 无子命令层（`gd-core brief [--json]`）：第二个位置参数已是旗标，不能当子命令查
if (cmd === "board") {
  process.exit(runBoard(process.argv.slice(3)) ?? 0);
}
if (cmd === "brief") {
  process.exit(runBrief(process.argv.slice(3)) ?? 0);
}

// 流转两族无子命令层（第一个位置参数就是任务 id）：`gd-core handoff|check <任务id>`
if (cmd === "handoff" || cmd === "check") {
  const run = cmd === "handoff" ? runHandoff : runCheck;
  process.exit(run(process.argv.slice(3)) ?? 0); // 首参是任务 id（无子命令层），已由 cmd/sub 取过
}

const family = cmd;
const subName = sub;
const args = rest;

/**
 * 已退场的命令（别笼统归到「属完整 CLI」——那会把人引到错的方向去找）。
 * 0.23.1 R-gm-075：`guide` 三条路径整体退场，SOP 改由 skill 分发。
 */
const RETIRED = {
  guide: "会话工作法不再由命令打印，已改为 skill `gd-core`：`gd-core skill install`（装到 .pi/skills/gd-core）或 `gd-core skill print`（直接看）",
};

const fam = FAMILIES[family];
if (!fam) {
  const retired = RETIRED[String(cmd ?? "")];
  if (retired) {
    console.error(`✗ \`${cmd}\` 已退役。`);
    console.error(`  · ${retired}`);
    process.exit(1);
  }
  console.error(`✗ gd-core 只提供 core 层的命令族：${Object.keys(FAMILIES).join(" / ")} + handoff / check`);
  console.error(`  收到（${cmd ?? "（空）"}）——该命令属完整 CLI（app 面：注册项目 / 席位 / 工作站）`);
  console.error("  · 用完整 CLI：gd <命令>（或设 GD_MAIN_LOCAL=<gdMain 仓根> 后由 core/bin/gd 转交）");
  process.exit(2);
}
if (!fam.subs.includes(subName)) {
  const retiredSub = subName === "guide" ? RETIRED.guide : null;
  if (retiredSub) {
    console.error(`✗ \`${family} guide\` 已退役。`);
    console.error(`  · ${retiredSub}`);
    process.exit(1);
  }
  // 没给子命令 ≠ 子命令非法：裸 `gd-core <族>` 打该族用法（与完整 CLI 的裸调用同口径）
  if (!subName) {
    console.log(`${family} — 需要子命令：\n  ${fam.hint}`);
    process.exit(0);
  }
  console.error(`✗ 未知子命令 "${family} ${subName}"。core 只提供：${fam.hint}`);
  console.error(`  其余 ${family} 子命令属完整 CLI（app 面：注册项目 / 自动提交 / 席位）`);
  process.exit(1);
}
process.exit(fam.run(subName, args) ?? 0);

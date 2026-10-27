#!/usr/bin/env node
/**
 * `gd core init` / `gd core status` —— **板自举**（0.19.0 C2 T2 · core 层）
 *
 * 定位：让任意 git 仓变成一块可用的板（board）——**不进 `projects/`、不建席位表、不读 `~/.gd/gdmain.yaml`**。
 *   设计权威源：`docs/gd-core-session-workflow-design.md` §3（板与项目 / 板根三形态 / 板解析三级顺序）。
 *
 * 用法：
 *   gd core init [--board-dir <路径>] [--in-tree] [--id <板id>] [--name <显示名>]
 *                [--tag <基线tag>] [--no-tag] [--force] [--dry-run] [--json]
 *   gd core status [--json]
 *
 * init 做什么（幂等；已存在只报告不改，`--force` 才重写配置）：
 *   ① 探测 git 工作区（worktree 感知：`.git` 文件 + `commondir`）
 *   ② 定板根：缺省 `<git-common-dir>/gdtwork`（worktree 共享 · 不入任何提交）· `--in-tree` 摆仓根 · `--board-dir` 显式
 *   ③ 定板 id（编号命名空间，缺省由目录名 kebab 化）：决定 `R-<id>-001` / `T-<id>-001-01` 形态
 *   ④ 写 `board.yaml`（core 最小档：schema / board.id / repo / executors 缺省 `local`）
 *   ⑤ 建账骨架（已存在不覆盖）：`milestones.yaml` · `reqs/index.yaml`
 *   ⑥ 打基线 tag（缺省 `core-base`；`--no-tag` 退出口）——并行会话的同一出发点 + 一键回退锚
 *   ⑦ 自检回读 + 报下一步
 *
 * 不做（边界）：不装依赖、不改仓库 `.gitignore`、不建分支/worktree（那是 `gd work start`）、
 *   不注册 `projects/_registry.yaml`、不建席位表、不启服务。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isConfirmed } from "./lib/confirm.mjs"; // 0.21.8：回滚须点名确认
import { doctorChecks, runDoctor } from "./core-doctor.mjs"; // 0.21.11：并行安全体检
import { runCoreVersion } from "./core-version.mjs"; // 0.24.2 R-gm-085：板上总控版本号（只读）
import { withBoardLock } from "./lib/board.mjs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { out, errOut } from "./lib/style.mjs";
import { parseArgs } from "./lib/args.mjs";
import {
  BOARD_ENV,
  BOARD_FILE,
  BOARD_SCHEMA,
  DEFAULT_BOARD_DIR,
  DEFAULT_EXECUTOR,
  boardIdFromName,
  boardMissingHint,
  gitWorktreeInfo,
  readBoardConfig,
  resolveBoard,
} from "./lib/board-resolve.mjs";
import { boardViewSummary, readBoardFacts, renderBoardBlock, writeBoardBlock } from "./lib/roadmap-view.mjs";
import { aheadBehind, commitsBetween, compareAccounts, ensureBoardRepo, fetchRemote, headOf, log as boardLog, push as boardPush, recordBackup, rescuePoint, resolveBackupTarget, restore as boardRestore, setBoardOrigin, snapshot, snapshotEnabled } from "./lib/board-vcs.mjs"; // 0.21.8：账库 · 0.22.4：异地备份与还原

export const CLI_FLAGS = ["--board-dir", "--in-tree", "--id", "--name", "--tag", "--no-tag", "--force", "--dry-run", "--json"];

/** 视图子命令的旗标（与 init/status 分开：写文件与建板是两件事） */
export const ROADMAP_FLAGS = ["--write", "--out", "--version", "--json"];

/** 账库子命令旗标 */
export const SNAP_FLAGS = ["--init", "--message", "--log", "--restore", "--confirm", "--json", "--backup", "--restore-remote", "--remote", "--ref", "--dry-run"];

/** 子命令清单（gd.mjs 路由校验 + 命令树守卫用） */
export const CORE_SUBCOMMANDS = ["init", "status", "roadmap", "snap", "doctor", "version"];

const USAGE = [
  "用法：",
  "  gd core init [--board-dir <路径>] [--in-tree] [--id <板id>] [--name <显示名>]",
  "               [--tag <基线tag>] [--no-tag] [--force] [--dry-run] [--json]",
  "  gd core status [--json] [--doctor]                     # 当前板上下文；--doctor 顺带一行体检摘要（有 ✗ 则 exit 1）",
  "  gd core roadmap [--write] [--version <x.y>] [--out <文件>] [--json]   # 派生视图；--write 写标记块，--version 只刷该版本块（并行友好）",
  "  gd core doctor [--json] [--fix]                      # 并行安全体检：账/占用/版本线/结版积压；--fix 清已收尾的残留占用",
  "  gd core snap [--init] [--message \"…\"] [--log [n]] [--restore <hash>] [--json]   # 账库：建库 / 立即快照 / 看历史 / 本地回滚",
  "  gd core snap --backup [--remote <url>] [--ref <ref>] [--dry-run] [--json]       # 异地备份：板账推交付仓远端一条 ref（缺省 gd-board）——里程碑结版（milestone reach）会自动跑一次",
  "  gd core snap --restore-remote [--remote <url>] [--ref <ref>] [--confirm <hash>] [--dry-run]   # 还原：先账结构对比，点名确认后覆盖（先存救援点）",
].join("\n");

/** 各子命令接受的旗标（写错当场拒，不静默忽略） */
const SUB_FLAGS = {
  init: CLI_FLAGS,
  status: ["--json", "--doctor"],
  roadmap: ROADMAP_FLAGS,
  snap: SNAP_FLAGS,
  doctor: ["--json", "--fix"],
  version: ["--json"],
};

const boardYamlText = ({ id, name, repo }) =>
  [
    "# 板配置（gd core · 0.19.0）——用 `gd core` / `gd milestone` 维护，勿手改格式",
    "# 口径：docs/gd-core-session-workflow-design.md §3；板根缺省 = <git-common-dir>/gdtwork（worktree 共享、不入提交）",
    `schema: ${BOARD_SCHEMA}`,
    "board:",
    `  id: ${id}                      # 编号命名空间：R-${id}-001 / T-${id}-001-01`,
    `  name: ${name}`,
    `repo: ${repo}                    # 板实绑定：交付件路径基准（板根 ≠ 代码根时以本行为准）`,
    "executors:                       # core 极简名册（app 注册 producer / 席位后自动扩充）",
    `  - id: ${DEFAULT_EXECUTOR}             # 缺省执行体：本机会话 / 人的手`,
    "",
  ].join("\n");

const milestonesYamlText = () =>
  [
    "# gd 里程碑账（板级 · 三层 workflow 顶层）——写法见 docs/gd-core-session-workflow-design.md §7；用 `gd milestone` 维护",
    "milestones: []",
    "",
  ].join("\n");

const reqsIndexText = () => ["# 需求索引（板级单一事实源）——序号锁内自增，勿手改", "next_req_no: 1", "requirements: []", ""].join("\n");

/** 幂等写：目标已存在则跳过（返回是否真写了） */
function writeIfAbsent(path, content, { force = false } = {}) {
  if (existsSync(path) && !force) return false;
  writeFileSync(path, content, "utf8");
  return true;
}

/** 板 id 原始值校验（不走 `boardIdFromName` 的容错派生：人显式给的 id 写错了就该报错） */
const BOARD_ID_RE = /^[a-z][a-z0-9-]*$/;

function gitTagOk(gitTop, tag) {
  const r = spawnSync("git", ["-C", gitTop, "tag", "--list", tag], { encoding: "utf8" });
  return { exists: (r.stdout ?? "").trim() === tag, ok: r.status === 0 };
}

function doInit(args) {
  const json = args.json === true;
  const dryRun = args["dry-run"] === true;

  const git = gitWorktreeInfo(process.cwd());
  if (!git) {
    console.error(errOut.err(`✗ 当前目录不在 git 工作区内（${process.cwd()}）——板必须绑一个 git 工作区`));
    return 1;
  }

  // 板根三形态：显式 > in-tree（仓根）> 缺省 <git-common-dir>/gdtwork
  let root;
  let rootMode;
  if (typeof args["board-dir"] === "string" && args["board-dir"].trim()) {
    const raw = args["board-dir"].trim();
    root = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
    rootMode = "board-dir";
    if (args["in-tree"] === true) {
      console.error(errOut.err("✗ --board-dir 与 --in-tree 互斥（显式板根 或 仓内摆法）"));
      return 1;
    }
  } else if (args["in-tree"] === true) {
    root = git.top;
    rootMode = "in-tree";
  } else {
    root = join(git.commonDir, DEFAULT_BOARD_DIR);
    rootMode = "common-dir";
  }

  const existing = readBoardConfig(root);
  if (existing.present && args.force !== true) {
    if (existing.error) {
      console.error(errOut.err(`✗ 已有板但配置不合法：${existing.error}`));
      console.error(`  · 修好后再跑，或 gd core init --force 重写配置（账件不动）`);
      return 1;
    }
    const payload = {
      ok: true,
      created: false,
      reason: "已存在板（幂等：不动任何文件；--force 才重写配置）",
      board: existing,
    };
    if (json) {
      console.log(JSON.stringify(payload, null, 2));
      return 0;
    }
    console.log(out.ok(`· 已有板：${existing.root}（id ${existing.id}）—— 幂等跳过`));
    printNext(existing);
    return 0;
  }

  const name = (typeof args.name === "string" && args.name.trim()) || basename(git.top);
  const rawId = typeof args.id === "string" && args.id.trim() ? args.id.trim() : null;
  const id = rawId ?? boardIdFromName(name);
  if (!id || !BOARD_ID_RE.test(id)) {
    console.error(errOut.err(`✗ 板 id 非法："${rawId ?? name}"——需小写 kebab（与 R-<id>-001 同形，如 gm / gdmain）；目录名派生失败时显式给 --id`));
    return 1;
  }

  const plan = {
    root: root.split("\\").join("/"),
    rootMode,
    gitTop: git.top,
    gitCommonDir: git.commonDir,
    id,
    name,
    repo: git.top,
    tag: args["no-tag"] === true ? null : String(args.tag ?? "core-base"),
    files: [join(root, BOARD_FILE), join(root, "milestones.yaml"), join(root, "reqs", "index.yaml")].map((p) => p.split("\\").join("/")),
  };

  if (dryRun) {
    if (json) console.log(JSON.stringify({ ok: true, dryRun: true, plan }, null, 2));
    else {
      console.log(out.dim("（dry-run：不落盘）"));
      console.log(`将建板：${plan.root}   # ${rootMode}`);
      console.log(`  板 id：${id}（编号前缀 R-${id}-001 / T-${id}-001-01）`);
      console.log(`  仓库：${plan.repo}`);
      for (const f of plan.files) console.log(out.dim(`    · ${f}  将写`));
    }
    return 0;
  }

  mkdirSync(join(root, "reqs"), { recursive: true });
  const force = args.force === true;
  const wrote = {
    board: writeIfAbsent(join(root, BOARD_FILE), boardYamlText({ id, name, repo: git.top }), { force }),
    milestones: writeIfAbsent(join(root, "milestones.yaml"), milestonesYamlText()),
    reqsIndex: writeIfAbsent(join(root, "reqs", "index.yaml"), reqsIndexText()),
  };

  // 基线 tag（并行会话的同一出发点；已存在则跳过）
  let tagResult = null;
  if (plan.tag) {
    const had = gitTagOk(git.top, plan.tag);
    if (!had.ok) tagResult = { tag: plan.tag, status: "failed", reason: "git tag 执行失败" };
    else if (had.exists) tagResult = { tag: plan.tag, status: "exists" };
    else {
      const r = spawnSync("git", ["-C", git.top, "tag", plan.tag], { encoding: "utf8" });
      tagResult = r.status === 0 ? { tag: plan.tag, status: "created" } : { tag: plan.tag, status: "failed", reason: (r.stderr ?? "").trim() };
    }
  }

  // 自检回读（写进去的要能被自己读懂）
  const verify = readBoardConfig(root);
  const okVerify = verify.present && !verify.error && verify.id === id;

  const payload = { ok: okVerify, created: true, wrote, tag: tagResult, board: verify };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return okVerify ? 0 : 1;
  }
  console.log(out.ok(`✅ 板已建好：${verify.root}`));
  console.log(`  板 id：${verify.id}   # 编号 R-${verify.id}-001 / T-${verify.id}-001-01`);
  console.log(`  仓库：${verify.repo ?? git.top}   # 交付件路径基准`);
  console.log(`  执行体：${verify.executors.map((e) => e.id).join(" / ")}   # 名册内自由；app 注册后扩充`);
  console.log(`  模式：${verify.mode}   # 由数据派生（seats/index.yaml 存在 ⇒ seat）`);
  for (const [label, p, w] of [
    ["板配置", join(root, BOARD_FILE), wrote.board],
    ["里程碑账", join(root, "milestones.yaml"), wrote.milestones],
    ["需求索引", join(root, "reqs", "index.yaml"), wrote.reqsIndex],
  ]) {
    console.log(out.dim(`    · ${p.split("\\").join("/")}  ${w ? "已写" : "已存在·未覆盖"}（${label}）`));
  }
  if (tagResult) {
    const label = { created: "已打基线 tag", exists: "基线 tag 已存在（跳过）", failed: "基线 tag 失败" }[tagResult.status];
    console.log(`  ${tagResult.status === "failed" ? errOut.err(`⚠ ${label}`) : label}：${tagResult.tag}${tagResult.reason ? `（${tagResult.reason}）` : ""}`);
  }
  if (!okVerify) {
    console.error(errOut.err(`✗ 自检未通过：${verify.error ?? "回读与写入不一致"}`));
    return 1;
  }
  printNext(verify);
  return 0;
}

/**
 * 收尾指路（`gd core init` 之后第一屏）——**先给工作法入口，再给三步命令**。
 * 这是「拿到板后怎么开工」的唯一出口，命令必须与当前能力一致：
 *   `gd task add --board` / `gd work *` / `handoff|check --board` 均已落地（0.19.0 收口），不留「未落地」措辞。
 */
function printNext(board) {
  const id = board.id ?? "<板id>";
  console.log("");
  console.log("下一步（三层 workflow）：");
  console.log("  ① 装工作法 skill（宿主按需加载）：gd-core skill install   # 替代旧的 guide：SOP 已改为 skills/gd-core");
  console.log('  ② 顶层：gd milestone add "<里程碑名>" --target <YYYY-MM-DD> --alias <版本号> --board');
  console.log(`  ③ 中层：gd req new "<需求标题>" --board            # 编号 R-${id}-001 锁内自增`);
  console.log('  ④ 底层：gd task add <需求id> --board --task "local:<任务标题>"');
  console.log(out.dim("  ⑤ 干活：gd work claim → start → submit → land → handoff → check（work 族不加 --board，其余加）"));
  console.log(out.dim("  ⑥ 账与备份（可选 · 账库默认关）：gd core snap --init（建账库）→ gd core snap --backup --remote <url>"));
  console.log(out.dim(`  临时切板：export ${BOARD_ENV}=<板根目录>；本板根 = ${board.root}`));
}

function doStatus(args) {
  const r = resolveBoard({ cwd: process.cwd() });
  if (args.json === true) {
    console.log(JSON.stringify({ ok: !!r.board, source: r.source, board: r.board, git: r.git, searched: r.searched }, null, 2));
    return r.board ? 0 : 1;
  }
  if (!r.board) {
    console.error(errOut.err(boardMissingHint(r.searched)));
    return 1;
  }
  const b = r.board;
  console.log(`当前板：${b.id}（${b.name ?? "-"}）   # 解析来源 = ${r.source}`);
  console.log(`  板根：${b.root}`);
  console.log(`  仓库：${b.repo ?? "-"}   # 交付件路径基准`);
  console.log(`  执行体：${b.executors.map((e) => e.id).join(" / ")}`);
  console.log(`  模式：${b.mode}（session = 会话语义 / seat = 席位语义）`);
  if (args.doctor !== true) return 0;
  // `--doctor`：一行体检摘要（完整报告仍归 `gd core doctor`；退出码跟随 ✗）
  const checks = doctorChecks(b);
  const fail = checks.filter((c) => c.level === "fail").length;
  const warn = checks.filter((c) => c.level === "warn").length;
  const icon = fail ? out.err("✗") : warn ? out.warn("⚠") : out.ok("✅");
  const backlog = (checks.find((c) => c.id === "close")?.rows ?? []).join(" / ");
  console.log(
    `  体检：${icon} ${checks.length - fail - warn}/${checks.length} 通过` +
      (fail ? ` · ${fail} 项需处理` : "") +
      (warn ? ` · ${warn} 项提醒` : "") +
      (backlog ? `（待结版 ${backlog}）` : "") +
      "   # 明细 gd core doctor"
  );
  return fail === 0 ? 0 : 1;
}

/** `gd core roadmap` —— 板上三层账的派生视图（默认打印；--write 写进 roadmap.md 标记块） */
function doRoadmap(args) {
  const json = args.json === true;
  const rb = resolveBoard({ cwd: process.cwd() });
  if (!rb.board || rb.board.error) {
    // 与 `gd core status` 共用同一份人读指路（一处措辞，不各写一套）
    if (json) console.log(JSON.stringify({ ok: false, error: rb.board?.error ?? "未定位到板", searched: rb.searched }, null, 2));
    else console.error(errOut.err(rb.board?.error ? `✗ 板配置不合法：${rb.board.error}` : boardMissingHint(rb.searched)));
    return 1;
  }
  const board = rb.board;
  const facts = readBoardFacts(board);
  const block = renderBoardBlock(board, facts);

  const version = typeof args.version === "string" && args.version.trim() ? args.version.trim() : null;
  if (version && !/^\d+\.\d+$/.test(version)) {
    console.error(errOut.err(`✗ --version 需 x.y 形态（现值：${version}）`));
    return 1;
  }
  if (json) {
    // 两轴模型：releases（发布轴）一并给机器读（版本号只在这里出现）
    console.log(JSON.stringify({ ok: true, board: board.id, mode: board.mode, summary: boardViewSummary(facts), milestones: facts.milestones, releases: facts.releases ?? [], reqs: facts.reqs }, null, 2));
    if (args.write === true) {
      const w = writeBoardBlock(board, block, { version });
      if (!w.ok) {
        console.error(errOut.err("✗ " + w.error));
        return 1;
      }
    }
    return 0;
  }

  if (args.write !== true) {
    console.log(block);
    if (args.out) {
      writeFileSync(String(args.out), block + "\n", "utf8");
      console.log(out.dim("（已写入 " + args.out + "）"));
    }
    return 0;
  }
  const w = writeBoardBlock(board, block, { version });
  if (!w.ok) {
    console.error(errOut.err("✗ " + w.error));
    return 1;
  }
  console.log(out.ok(`✅ 派生视图${w.mode === "unchanged" ? "**已是最新（内容未变，未写盘）**" : "已刷新"}：${w.path}（${w.scope ? w.scope : w.mode === "replaced" ? "替换标记块" : w.mode === "unchanged" ? "无 diff ⇒ 不动文件" : "追加到文末"}）`));
  // 报告必须与真实后果对齐：没写盘就不说「已刷新」—— 否则人会以为文件变了，去查一个不存在的 diff
  if (w.mode === "unchanged") console.log(out.dim("  · 抹掉生成时间戳后内容一致 ⇒ 不写盘（git 看不到改动，这是对的）"));
  console.log(out.dim("  · 账是真相、视图可重算；手改视图会被下次重算覆盖"));
  return 0;
}

/**
 * 备份 / 还原的远端落点：`--remote` > 板账仓 origin > 交付仓 origin。
 *   `explicit` 标记地址是否来自旗标——只有显式给了才写进板账仓 origin（不悄悄改配置）。
 */
/** 数字增减的紧凑写法（`+2` / `-1` / `0`） */
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? String(n) : "0");

/** 还原前的**账结构对比**（人读：算的是需求/任务/子版/线/里程碑，不是 git diff） */
function renderAccountDiff({ ref, f, ab, cmp, localOnly, remoteOnly }) {
  const L = [];
  const dir = ab.behind > 0 && ab.ahead === 0
    ? `远端领先 ${ab.behind} 版`
    : ab.ahead > 0 && ab.behind === 0
      ? `本地领先 ${ab.ahead} 版`
      : `两边分叉（远端领先 ${ab.behind} · 本地领先 ${ab.ahead}）`;
  L.push(`账结构对比：本地 HEAD ↔ ${ref} @ ${f.short}（${dir}）`);
  L.push(`  需求   ${cmp.local.reqs.length} → ${cmp.remote.reqs.length}`);
  for (const r of cmp.reqsAdded) L.push(`    + ${r.id}${r.subver ? ` [${r.subver}]` : ""} ${r.title}`);
  for (const r of cmp.reqsRemoved) L.push(`    - ${r.id}${r.subver ? ` [${r.subver}]` : ""} ${r.title}`);
  if (cmp.reqsChanged.length) {
    L.push(out.warn(`  ~ 同一 id 内容不同 ${cmp.reqsChanged.length} 条（可能是状态漂移，也可能是两台机撞号）：`));
    for (const { local: l, remote: r } of cmp.reqsChanged) {
      const bits = [];
      if (l.title !== r.title) bits.push(`标题「${l.title}」→「${r.title}」`);
      if (l.status !== r.status) bits.push(`状态 ${l.status} → ${r.status}`);
      if (l.subver !== r.subver) bits.push(`子版 ${l.subver || "—"} → ${r.subver || "—"}`);
      if (l.task_done !== r.task_done || l.task_count !== r.task_count) bits.push(`任务 ${l.task_done}/${l.task_count} → ${r.task_done}/${r.task_count}`);
      L.push(`    ${r.id}  ${bits.join(" · ")}`);
    }
  }
  L.push(`  任务   ${cmp.local.tasks.count} → ${cmp.remote.tasks.count}（已完成 ${cmp.local.tasks.done} → ${cmp.remote.tasks.done}，本次 ${signed(cmp.taskDelta.count)} / 完成 ${signed(cmp.taskDelta.done)}）`);
  if (cmp.subversAdded.length) L.push(`  子版   ${cmp.remote.subvers.length} 条 → 新增 ${cmp.subversAdded.join(" / ")}`);
  else L.push(`  子版   ${cmp.remote.subvers.length} 条（无新增）`);
  if (cmp.lanesChanged.length) L.push(`  版本线 变动：${cmp.lanesChanged.join(" / ")}`);
  else L.push(`  版本线 无变动`);
  if (cmp.milestones.added.length || cmp.milestones.dropped.length) {
    L.push(`  里程碑 新增 ${cmp.milestones.added.join(" / ") || "无"} · 丢失 ${cmp.milestones.dropped.join(" / ") || "无"}`);
  } else L.push(`  里程碑 无变动`);
  if (cmp.remote.missing.length) L.push(out.warn(`  ⚠️ 远端缺账文件：${cmp.remote.missing.join(" / ")}`));

  if (localOnly.length) {
    L.push(out.err(`⚠️ 本地独有 ${localOnly.length} 版提交在覆盖后将从账上消失（覆盖前会存救援点）：`));
    for (const c of localOnly.slice(0, 5)) L.push(out.err(`    · ${c.hash}  ${c.at}  ${c.subject}`));
    if (localOnly.length > 5) L.push(out.dim(`    …另有 ${localOnly.length - 5} 版`));
  }
  if (remoteOnly.length) {
    L.push(out.dim(`本次将带回来的远端提交（${remoteOnly.length} 版，最近 5 条）：`));
    for (const c of remoteOnly.slice(0, 5)) L.push(out.dim(`    · ${c.hash}  ${c.at}  ${c.subject}`));
  }
  return L.join("\n");
}

/** `gd core snap` —— 账库：建库 / 立即快照 / 看历史 / 本地回滚（0.21.8）+ 异地备份 / 还原（0.22.4） */
function doSnap(args) {
  const json = args.json === true;
  const rb = resolveBoard({ cwd: process.cwd() });
  if (!rb.board || rb.board.error) {
    console.error(errOut.err(`✗ 未定位到板（${rb.board?.error ?? "三处皆无"}）——先 gd core init`));
    return 1;
  }
  const board = rb.board;
  // `--backup` / `--restore-remote` 是纯开关：错把地址写在它们后面会静默落进普通快照分支，当场拦掉
  for (const k of ["backup", "restore-remote"]) {
    if (typeof args[k] === "string") {
      console.error(errOut.err(`✗ --${k} 不带值：远端地址请用 --remote <url>`));
      return 1;
    }
  }
  if (typeof args.restore === "string" && args.restore.trim()) {
    // 回滚同样是高危动作：点名确认，与 reach/reopen/fold 同口径
    if (!isConfirmed({ confirm: args.confirm }, args.restore)) {
      console.error(errOut.err(`✗ 回滚会覆盖当前账，必须点名确认：--confirm ${args.restore.trim()}`));
      return 1;
    }
    return withBoardLock(board.root, () => {
      const r = boardRestore(board.root, args.restore);
      if (!r.ok) {
        console.error(errOut.err(`✗ ${r.error}`));
        return 1;
      }
      if (json) console.log(JSON.stringify({ ok: true, restored: r.hash }, null, 2));
      else console.log(out.ok(`✅ 账已回滚到 ${r.hash}`));
      return 0;
    }, { label: "snap --restore" });
  }

  if (args.init === true) {
    const r = ensureBoardRepo(board.root);
    if (!r.ok) {
      console.error(errOut.err(`✗ ${r.error}`));
      return 1;
    }
    if (json) console.log(JSON.stringify({ ok: true, created: r.created, path: r.path, first: r.first ?? null, hygiene: r.hygiene ?? [] }, null, 2));
    else {
      console.log(out.ok(`✅ 账库就绪：${r.path}${r.created ? "（新建）" : "（已存在）"}`));
      if (r.hygiene?.length) console.log(out.dim(`  · 卫生：${r.hygiene.join(" / ")}`));
      console.log(out.dim("  · 之后每次写账都会自动快照（GD_BOARD_SNAPSHOT=0 可临时关）"));
      console.log(out.dim("  · 异地备份（可选）：gd core snap --backup --remote <url>（缺省推交付仓 origin 的 gd-board ref）"));
    }
    return 0;
  }

  if (args.log !== undefined) {
    const n = typeof args.log === "string" ? Number(args.log) : 10;
    const r = boardLog(board.root, Number.isFinite(n) && n > 0 ? n : 10);
    if (json) {
      console.log(JSON.stringify({ ok: r.ok, entries: r.entries, skipped: r.skipped ?? null }, null, 2));
      return r.ok ? 0 : 1;
    }
    if (!r.ok) {
      console.error(errOut.err(`✗ ${r.skipped}`));
      return 1;
    }
    console.log(`账快照历史（最近 ${r.entries.length} 版）：`);
    for (const e of r.entries) console.log(`  ${e.hash}  ${e.at}  ${e.subject}`);
    return 0;
  }

  // ── 0.22.4：异地备份 / 从远端还原（两条共用「远端落点 + ref + dry-run」）─────
  const remoteIntent = args.backup === true || args["restore-remote"] === true;
  const target = remoteIntent ? resolveBackupTarget(board, { remote: args.remote, ref: args.ref }) : null;
  const ref = target?.ref;
  const dry = args["dry-run"] === true;
  if (target && !target.url) {
    console.error(errOut.err("✗ 没找到可用的远端地址：给 --remote <url>，或先给交付仓配 origin（备份推它的一条独立 ref）"));
    return 1;
  }

  // ── 异地备份（板账 → 远端一条 ref）──────────────────────────────
  if (args.backup === true) {
    if (dry) {
      if (json) console.log(JSON.stringify({ ok: true, dryRun: true, ...target, ref, head: headOf(board.root) }, null, 2));
      else {
        console.log("[dry-run] 将把板账备份到：");
        console.log(`  板：${board.id} · 远端：${target.url}（来源：${target.source}）· ref：${ref} · 当前 HEAD：${headOf(board.root)}`);
        console.log(out.dim("  · 未做快照、未推送（去掉 --dry-run 才真执行）"));
      }
      return 0;
    }
    // 前置快照（幂等）：保证「最后一次写账」也被带走
    const snap = snapshot(board.root, typeof args.message === "string" ? args.message : `board: 备份快照 ${new Date().toISOString()}`);
    if (!snap.ok) {
      console.error(errOut.err(`✗ 备份前快照失败：${snap.skipped ?? "未知"}`));
      return 1;
    }
    const r = boardPush(board.root, { url: target.url, ref });
    if (!r.ok) {
      console.error(errOut.err(`✗ ${r.error}`));
      return 1;
    }
    // 只在显式给了 --remote 时才落 origin（不悄悄改配置），落了以后就可零参数
    const saved = target.explicit ? setBoardOrigin(board.root, target.url) : null;
    // 留痕（`.gd/` 已忽略，只记本机事实）：体检靠它判断“有没有过异地副本”
    const mark = recordBackup(board.root, { url: target.url, ref, hash: r.hash });
    if (json) {
      console.log(JSON.stringify({ ok: true, board: board.id, url: target.url, source: target.source, ref, hash: r.hash, upToDate: r.upToDate === true, originSaved: saved?.ok === true, snapshot: snap.nochange ? null : snap.hash }, null, 2));
      return 0;
    }
    console.log(r.upToDate
      ? out.ok(`· 远端已是最新（${ref} @ ${r.hash}）——无新提交可推`)
      : out.ok(`✅ 板账已备份 → ${ref} @ ${r.hash}`));
    console.log(out.dim(`  · 远端：${target.url}（${target.source}）`));
    if (saved?.ok) console.log(out.dim(`  · 已把该地址写进板账仓 origin：以后 \`gd core snap --backup\` 可零参数`));
    if (!mark.ok) console.log(out.dim(`  · 备份留痕未写成（${mark.skipped}）——不影响备份本身`));
    console.log(out.dim(`  · 另一台机拉回：gd core snap --restore-remote`));
    return 0;
  }

  // ── 从远端还原（先对比 → 点名确认 → 存救援点 → 覆盖）────────────────
  if (args["restore-remote"] === true) {
    // 本地先落定（脏账先提一版），否则 reset --hard 会静默吃掉未快照的写
    const snap = snapshot(board.root, `board: 还原前快照 ${new Date().toISOString()}`);
    if (!snap.ok) {
      console.error(errOut.err(`✗ 本地账快照失败，不敢覆盖：${snap.skipped ?? "未知"}`));
      return 1;
    }
    const f = fetchRemote(board.root, { url: target.url, ref });
    if (!f.ok) {
      console.error(errOut.err(`✗ ${f.error}`));
      return 1;
    }
    const ab = aheadBehind(board.root, f.stage);
    const cmp = compareAccounts(board.root, f.stage);
    const localOnly = ab.ahead > 0 ? commitsBetween(board.root, f.stage, "HEAD") : [];
    const remoteOnly = ab.behind > 0 ? commitsBetween(board.root, "HEAD", f.stage) : [];

    // 两边一致 ⇒ 无可还原（dry-run 与非 dry-run 都不动手）
    if (ab.ahead === 0 && ab.behind === 0) {
      if (json) console.log(JSON.stringify({ ok: true, unchanged: true, board: board.id, ref, remote: f.short, compare: cmp }, null, 2));
      else console.log(out.ok(`· 本地与远端一致（${ref} @ ${f.short}）——无需还原`));
      return 0;
    }

    // 对比先给人看；dry-run 到此为止（什么都不碰，不落救援点）
    if (dry) {
      if (json) {
        console.log(JSON.stringify({ ok: true, dryRun: true, board: board.id, url: target.url, source: target.source, ref, remote: f.short, ahead: ab.ahead, behind: ab.behind, localOnly, remoteOnly, compare: cmp, needConfirm: f.short }, null, 2));
      } else {
        console.log(renderAccountDiff({ ref, f, ab, cmp, localOnly, remoteOnly }));
        console.log(out.dim(`  · [dry-run] 未覆盖任何东西；真执行：--confirm ${f.short}`));
      }
      return 0;
    }
    if (!json) console.log(renderAccountDiff({ ref, f, ab, cmp, localOnly, remoteOnly }));
    // 高危动作：点名确认（与 reach/reopen/fold/--restore 同口径）
    if (!isConfirmed({ confirm: args.confirm }, f.short) && !isConfirmed({ confirm: args.confirm }, f.hash)) {
      console.error(errOut.err(`✗ 覆盖本地账是高危动作，必须点名确认：--confirm ${f.short}`));
      return 1;
    }
    return withBoardLock(board.root, () => {
      const rescue = rescuePoint(board.root);
      const r = boardRestore(board.root, f.stage);
      if (!r.ok) {
        console.error(errOut.err(`✗ ${r.error}`));
        return 1;
      }
      if (json) {
        console.log(JSON.stringify({ ok: true, restored: r.hash, from: f.short, rescue: rescue.ok ? { ref: rescue.ref, hash: rescue.hash } : null }, null, 2));
        return 0;
      }
      console.log(out.ok(`✅ 账已还原到远端 ${f.short} → 本地 ${r.hash}`));
      if (rescue.ok) {
        console.log(out.dim(`  · 覆盖前状态已存救援点 ${rescue.ref}（${rescue.hash}）`));
        console.log(out.dim(`    反悔：gd core snap --restore ${rescue.hash} --confirm ${rescue.hash}`));
      }
      return 0;
    }, { label: "snap --restore-remote" });
  }

  const r = snapshot(board.root, typeof args.message === "string" ? args.message : "board: 手动快照");
  if (!r.ok) {
    console.error(errOut.err(`✗ ${r.skipped ?? "快照失败"}`));
    return 1;
  }
  if (json) console.log(JSON.stringify({ ok: true, ...r, enabled: snapshotEnabled(board.root) }, null, 2));
  else console.log(out.ok(r.nochange ? "· 账无变化，未产生新快照" : `✅ 已打快照 ${r.hash}`));
  return 0;
}

/** 入口（gd.mjs \`core\` 家族转发） */
export function runCore(sub, rest) {
  const subName = String(sub ?? "");
  if (!CORE_SUBCOMMANDS.includes(subName)) {
    console.error(errOut.err(`✗ 未知子命令 "core ${subName}"。可用：${CORE_SUBCOMMANDS.join(" / ")}\n${USAGE}`));
    return 1;
  }
  const args = parseArgs(rest);
  const allowed = SUB_FLAGS[subName];
  const unknown = Object.keys(args).filter((k) => k !== "_" && !allowed.includes(`--${k}`));
  if (unknown.length) {
    console.error(errOut.err(`✗ 未知参数：${unknown.map((k) => `--${k}`).join(" ")}（core ${subName} 接受：${allowed.join(" ")}）\n${USAGE}`));
    return 1;
  }
  if (subName === "init") return doInit(args);
  if (subName === "roadmap") return doRoadmap(args);
  if (subName === "snap") return doSnap(args);
  if (subName === "doctor") return runDoctor(args);
  if (subName === "version") return runCoreVersion(args);
  return doStatus(args);
}

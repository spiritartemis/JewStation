#!/usr/bin/env node
/**
 * `gd work` —— 会话认领（core 层 · 0.19.0 C3）
 *
 * 定位：`core` 模式下「谁此刻在干哪个任务」的唯一入口。**不依赖席位 / worker**——
 *   负责人 = 板内名册里的执行体名（`executor`），占用 = `claim{}`（session / pid / host / 租约）。
 *   设计权威源：`docs/gd-core-session-workflow-design.md` §4、§5。
 *
 * 用法：
 *   gd work claim <任务id> [--executor <名册id>] [--ttl <分钟>] [--json]
 *   gd work release <任务id> [--force] [--json]
 *   gd work list [--json]
 *   gd work start <任务id> [--base <ref>] [--worktree-dir <目录>] [--json]
 *   gd work submit <任务id> [--message "<提交信息>"] [--json]
 *   gd work land <任务id> [--keep] [--json]
 *
 * 口径：
 *   · **租约 15 分钟**（`--ttl` 可调），每次 `gd work` 动账自动续期；过期即可被他人抢（不锁死）。
 *   · 认领同一任务：`ready` → `in_progress`（同一把板锁内完成，竞态只有一个赢）；
 *     已被他人持有时拒（`E_CLAIMED`，指明持有者与剩余租约）。
 *   · 交还：清 `claim` + `in_progress` → `ready`（回池）；非持有者交还需 `--force`（审计留痕）。
 *   · 任务 id 前缀即板 id（`T-<板id>-…`）：**前缀不符直接拒**——防止在 A 板命令里误操作 B 的账。
 *
 * 并发隔离（C4 · 0.19.0）：**账互斥**（claim 租约）与**代码隔离**（git worktree + 串行快进合入）两件都要——
 *   只做账互斥 = 「账不冲突，但两个人同时改同一个文件，合并时互相覆盖」。
 *   ① `start`：给任务开一块独立工作区（`task/<任务id>` 分支），多会话各在各的目录里改；
 *   ② `submit`：把该工作区的改动**精确路径**提交，再 rebase 到基线（冲突即停 + 回滚，不动其他人的工作区）；
 *   ③ `land`：**串行**快进合入基线（`--ff-only`）——基线被抢先推进时拒绝并要求重新 submit，绝不产生合并提交。
 *
 * 边界（**仍未做**）：`denyTaskWrite` 的 owner 写面放开——它要按「任务 id 前缀 = 板 id」判定上下文，
 *   与 C5（`gd req/task` 获得板上下文）同批做，避免在 cwd 双坐标下把账写错地方。
 */
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { errOut, out } from "./lib/style.mjs";
import { parseArgs } from "./lib/args.mjs";
import { DEFAULT_EXECUTOR, resolveBoard } from "./lib/board-resolve.mjs";
import { appendEvents, findTaskAnywhere, ledgerBlock, mutateTaskLedger, readReqEntries, readTaskLedger, withBoardLock, withConflictRetry, writeTaskLedger } from "./lib/board.mjs";
import { buildCommitMessage, commitFiles, isRepo, porcelainPaths, runGit } from "./lib/gitcore.mjs"; // 0.19.0 R-gm-005：只用 git 纯操作，core 闭包不拖宿主件
import { DEFAULT_LEASE_MINUTES, claimOf, describeClaim, isClaimExpired, makeClaim, sessionIdFromEnv } from "./lib/workclaim.mjs";
import { findUnitFor, unitOfTask, unitUnsubmitted, workUnitId } from "./lib/workunit.mjs"; // 0.41：工作单元（执行体 × 需求）
import { applyWorkUnitMigration, planWorkUnitMigration } from "./lib/work-migrate.mjs"; // 0.41：旧 work 块 → 工作单元
import { findExternalLinks, unlinkLink } from "./lib/work-links.mjs";
import { preflight, preflightLines } from "./lib/work-batch.mjs"; // 0.45 T-gm-45-0-01：合批前的撞车预检（只读） // 0.45：指向外部的联接（start / land / sweep 三处共用一份）
import { DEFAULT_STALE_DAYS, SWEEP_LOG_REL, appendSweepLog, classifyUnit, nextCheckText, readSweepLog, summarize } from "./lib/work-sweep.mjs"; // 0.45 T-gm-45-0-02：工作区清扫的判定与留痕
import { checkDepsHealth, depsHealthLine } from "./lib/deps-health.mjs"; // 0.45：依赖健康哨兵
import { depsRootsFor, sharedRootForRepo, sharedDepsStatus, syncSharedDeps } from "./lib/work-deps.mjs"; // 0.45：共享依赖
import { resolveSeatTarget } from "./lib/tasktarget-core.mjs";
import { actorOf, assertLane, readLanes, versionOfSubver } from "./lib/lanes.mjs"; // 0.21.5：版本线归属闸门
import { isReqDir } from "./lib/reqid.mjs"; // 0.23.0 R-gm-061：需求目录形态（R- / B-）
import { depGateLines, depGateOf } from "./lib/dep-gate.mjs"; // 0.47 R-gm-104：依赖闸门（只算不写）

export const CLI_FLAGS = ["--executor", "--ttl", "--force", "--json", "--claim", "--all", "--base", "--worktree-dir", "--message", "--keep", "--apply", "--prune-done", "--days", "--history", "--ignore-deps"];

/** 子命令清单（gd.mjs 路由校验 + 命令树守卫用） */
export const WORK_SUBCOMMANDS = ["claim", "release", "list", "next", "start", "submit", "land", "migrate", "sweep", "deps"];

const USAGE = [
  "用法：",
  "  gd work claim <任务id> [--executor <名册id>] [--ttl <分钟>] [--json]",
  "  gd work release <任务id> [--force] [--json]",
  "  gd work list [--json] [--all]                            # 占用清单 + 工作单元清单（默认只列还没收尾的；--all 含已完成）",
  "  gd work next [--executor <名册id>] [--claim] [--json]    # 按身份+版本线领下一个任务（--claim 一步到位）",
  "  gd work start <任务id> [--executor <名册id>] [--base <ref>] [--worktree-dir <目录>] [--ignore-deps] [--json]   # 开隔离工作区（task/<任务id> 分支；依赖未满足会拒）",
  "  gd work submit <任务id> [--message \"<提交信息>\"] [--json]                                       # 提交并 rebase 到基线",
  "  gd work land <任务id…> [--keep] [--force] [--json]                                             # 快进合入基线（多个 id = 一次板锁合多分支；--force 越过单元交件闸门，留痕）",
  "  gd work migrate [--apply] [--prune-done] [--json]                                              # 旧 work 块 → 工作单元（缺省只看计划）",
  "  gd work deps [--apply] [--json] [--worktree-dir <目录>]                    # 共享依赖（公共父目录装一份 · 不建联接）",
  "  gd work sweep [--apply] [--days <n>] [--history] [--json]                                       # 清扫 kept 工作区（缺省只看：谁留着、为什么、何时再看）",
  "  （不动 git 的日常：认领 → 开工 → 交件 handoff → 验收 check）",
].join("\n");

const SUB_FLAGS = {
  claim: ["--executor", "--ttl", "--json", "--force"],
  next: ["--executor", "--ttl", "--json", "--claim", "--force"],
  release: ["--force", "--json"],
  list: ["--json", "--all"],
  start: ["--executor", "--ttl", "--base", "--worktree-dir", "--json", "--ignore-deps"],
  submit: ["--message", "--json"],
  land: ["--keep", "--json", "--force"],
  migrate: ["--apply", "--prune-done", "--json"],
  deps: ["--apply", "--json", "--worktree-dir"],
  sweep: ["--apply", "--days", "--history", "--json"],
};

/** 定位失败统一出口（错误 + 可选指路，五处调用同一口径） */
/** 当前 cwd 是否落在给定目录内（worktree 回收前判断人在哪儿；0.21.15） */
function cwdWithin(dir) {
  try {
    const cwd = process.cwd();
    const rel = relative(resolve(dir), resolve(cwd));
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  } catch {
    return false; // cwd 已被删（理论上进不来）⇒ 视为不在内
  }
}

function failLoc(loc) {
  console.error(errOut.err(`✗ ${loc.error}`));
  for (const h of loc.hint ?? []) console.error(`  · ${h}`);
  return 1;
}

/**
 * git 失败原因摘要（**入库用**：单行 · 截断 · 不带换行）
 * 为什么要摘要而不是原文：回收失败的原因要落进板账 `landed.cleanup`（B-gm-002）——
 *   git 的报错常带多行与路径，全量塞账会让账面没法读；取前两行足够定位（锁 / 占用 / 路径错）。
 */
function failReason(r, max = 200) {
  const raw = String(r?.stderr || r?.stdout || "").trim();
  if (!raw) return "（git 无输出）";
  const one = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" / ");
  return one.length > max ? one.slice(0, max) + "…" : one;
}

/**
 * git 的「这个分支本来就没有」识别（B-gm-000033）。
 *
 * 为什么单列一条：回收类命令有**三种**结局 —— 做了 / 本来就不需要做 / 做失败了。
 *   git 对不存在的分支 exit 1 并报 `error: branch 'x' not found`，若直接塞进失败原因，
 *   输出里就会在「已回收」下面挂一句 `error:`，读的人无法判断到底还有没有残留。
 *   **「目标已经不存在」不是失败**，是「无需动作」——混成两态就等于丢掉了这条信息。
 */
function branchAbsent(r) {
  return /branch\s+'[^']*'\s+not found/i.test(`${r?.stderr ?? ""}${r?.stdout ?? ""}`);
}

/** 删分支三态 → cleanup 标记（落账与打印共用这一份口径，别各写一套） */
function branchCleanup(r) {
  if (!r || r.ok) return "branch-deleted";
  return branchAbsent(r) ? "branch-absent" : `branch ${failReason(r)}`;
}

const CLEANUP_TEXT = {
  "worktree+branch": "工作区与分支均已回收",
  "branch-deleted": "分支已删除",
  "branch-absent": "分支本就不存在（无需删除）",
};

/** cleanup 标记 → 人话（只给打印面；机器面仍用标记，别在账里存句子） */
function cleanupText(c) {
  const s = String(c ?? "");
  if (!s) return "";
  if (CLEANUP_TEXT[s]) return CLEANUP_TEXT[s];
  const m = /^worktree removed · (.+)$/.exec(s);
  if (m) return `工作区已回收 · ${CLEANUP_TEXT[m[1]] ?? m[1]}`;
  return s;
}

/**
 * 定位板与任务（**与 `lib/board-context.mjs: locateBoardTask` 刻意分开**）。
 * 差别只在一条闸门：`gd work` 允许在**席位语义**的板上认领（占用是全会话基础设施，不随写面归属变），
 *   `locateBoardTask` 服务于 owner 写面（task add / handoff / check），那里席位语义板必须拒。
 *   `work-claim-e2e` 已钉住这一行为（“席位表在 ⇒ 模式派生 seat，但认领仍可用”）。
 */
function locate(taskId) {
  const rb = resolveBoard({ cwd: process.cwd() });
  if (!rb.board) return { error: `未定位到板——先 gd core init`, hint: rb.searched };
  if (rb.board.error) return { error: `板配置不合法：${rb.board.error}` };
  const board = rb.board;
  if (taskId && !String(taskId).startsWith(`T-${board.id}-`)) {
    return {
      error: `任务 "${taskId}" 不属于本板（板 id ${board.id}，任务 id 前缀应为 T-${board.id}-）`,
      hint: ["在别的板 / 注册项目里就用那边的上下文：cd 到该仓，或 --project <id>（app 面）/ GD_BOARD=<板根>"],
    };
  }
  const hit = taskId ? findTaskAnywhere(board.root, taskId) : null;
  if (taskId && !hit) return { error: `任务 ${taskId} 不在本板的任何需求账里` };
  return { board, hit };
}

function mangleExecutor(board, wanted) {
  // 判据单源 = lib/tasktarget-core.resolveSeatTarget（板内名册 ∪ 席位 ∪ 席位内 worker ∪ 自产哨兵）
  const r = resolveSeatTarget(board.root, wanted);
  if (r.ok) return { ok: true, id: wanted, kind: r.kind };
  return {
    ok: false,
    error: `执行体 "${wanted}" 不在可用名册（板名册 ${board.executors.map((e) => e.id).join(" / ")}${r.known.length > board.executors.length ? ` · 另含席位/worker：${r.known.filter((x) => !board.executors.some((e) => e.id === x)).join(" / ")}` : ""}）`,
  };
}

/**
 * 认领内核（claim / start 共用）：读账 → 闸门 → 写 claim + 状态 + 事件（全在同一把板锁内）。
 * @returns {{ok: true, task: object, reqId: string, fromStatus: string, renewed: boolean} | {ok: false, error: string, hint?: string[]}}
 */
function claimCore({ board, hit, taskId, executor = null, ttl = DEFAULT_LEASE_MINUTES, session, argsForce = false }) {
  return withBoardLock(board.root, () =>
    withConflictRetry(() => {
      const ledger = readTaskLedger(board.root, hit.reqId);
      const task = ledger.tasks.find((t) => t.id === taskId);
      if (!task) return { ok: false, error: `任务 ${taskId} 不在 ${hit.reqId} 账内（并发删除？重跑 gd work list）` };
      if (task.status === "review" || task.status === "done") {
        return { ok: false, error: `任务 ${taskId} 当前 ${task.status}——不接新认领（review/done 归验收面）` };
      }
      // 0.21.5：版本线归属闸门——本任务所属需求的 subver 归他人时拒（force 可越过）
      const reqEntry = readReqEntries(board.root).find((r) => String(r.id) === String(hit.reqId));
      const gate = assertLane(board.root, reqEntry?.subver, { board, force: argsForce });
      if (gate) return { ok: false, error: gate.error, hint: [gate.hint] };
      const existing = claimOf(task);
      const mine = existing?.session === session;
      if (existing && !mine && !isClaimExpired(existing, { minutes: ttl })) {
        return {
          ok: false,
          error: `任务 ${taskId} 已被 ${describeClaim(existing, { minutes: ttl })} 持有（E_CLAIMED）`,
          hint: [`等租约过期（${ttl} 分钟无心跳即自动可抢），或让持有者 gd work release ${taskId}`],
        };
      }
      // 负责人：显式 --executor > 既有 executor > 板缺省 local
      const wanted = (executor && String(executor).trim()) || String(task.executor ?? "").trim() || DEFAULT_EXECUTOR;
      const who = mangleExecutor(board, wanted);
      if (!who.ok) return { ok: false, error: who.error };

      const next = { ...task, executor: who.id, claim: makeClaim({ existing, session, ttlMinutes: ttl }) };
      const fromStatus = task.status;
      if (task.status === "ready") next.status = "in_progress";
      const tasks = ledger.tasks.map((t) => (t.id === taskId ? next : t));
      writeTaskLedger(board.root, hit.reqId, { req: ledger.req, tasks }, { expectedRev: ledger.revision });
      appendEvents(board.root, hit.reqId, [
        {
          kind: "claim",
          actor: who.id,
          task: taskId,
          to: who.id,
          state: "working",
          text: `会话 ${session} 认领（租约 ${ttl} 分钟${fromStatus !== next.status ? ` · ${fromStatus} → ${next.status}` : " · 续期"}）`,
          ...(existing && !mine ? { prev: `${existing.session}@${existing.host ?? "-"}（租约过期接管）` } : {}),
        },
      ]);
      return { ok: true, task: next, reqId: hit.reqId, fromStatus, renewed: !!existing && mine };
    })
  );
}

function doClaim(args) {
  const json = args.json === true;
  const taskId = args._?.[0] ? String(args._[0]) : null;
  if (!taskId) {
    console.error(errOut.err(`✗ 缺任务 id
${USAGE}`));
    return 1;
  }
  const ttl = args.ttl === undefined ? DEFAULT_LEASE_MINUTES : Number(args.ttl);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    console.error(errOut.err(`✗ --ttl 需正数（分钟）`));
    return 1;
  }
  const loc = locate(taskId);
  if (loc.error) return failLoc(loc);
  const { board, hit } = loc;
  const session = sessionIdFromEnv();
  const r = claimCore({ board, hit, taskId, executor: args.executor, ttl, session, argsForce: args.force === true });
  if (!r.ok) {
    console.error(errOut.err(`✗ ${r.error}`));
    for (const h of r.hint ?? []) console.error(`  · ${h}`);
    return 1;
  }
  const next = r.task;
  if (json) {
    console.log(
      JSON.stringify(
        { ok: true, task: next.id, req: r.reqId, executor: next.executor, session, ttl_minutes: ttl, status: next.status, claim: next.claim, renewed: r.renewed },
        null,
        2
      )
    );
    return 0;
  }
  console.log(out.ok(`✅ 已认领 ${taskId}（负责人 ${next.executor} · 会话 ${session} · 租约 ${ttl} 分钟）`));
  console.log(`  ${r.fromStatus === next.status ? "续期" : `${r.fromStatus} → ${next.status}`}   # 板 ${board.id}（${board.mode} 模式）`);
  console.log(out.dim(`  · 开隔离工作区：gd work start ${taskId}   · 交还：gd work release ${taskId}`));
  return 0;
}

/** 改任务账上的一个字段块（work / submitted / landed），冲突自动重放 */
function patchTask(board, reqId, taskId, mutate) {
  return withBoardLock(board.root, () =>
    withConflictRetry(() => {
      const ledger = readTaskLedger(board.root, reqId);
      const task = ledger.tasks.find((t) => t.id === taskId);
      if (!task) return { ok: false, error: "任务 " + taskId + " 不在 " + reqId + " 账内" };
      const next = mutate({ ...task });
      const tasks = ledger.tasks.map((t) => (t.id === taskId ? next : t));
      // ⚠️ **工作单元要一起写回**（0.41）：work_units 是需求级账目，漏传 ⇒ 被这次写覆盖清空
      writeTaskLedger(board.root, reqId, { req: ledger.req, tasks, work_units: ledger.workUnits ?? [] }, { expectedRev: ledger.revision });
      return { ok: true, task: next };
    })
  );
}

/**
 * 依赖健康哨兵（0.45 · T-45-0-04）：工作区动作后说一句人话。
 *
 * 背景：主仓 node_modules 被清空过一次，期间没有任何环节报人话——直到跑 e2e 才炸「Cannot find package」，
 *   人还以为是代码坏了。**工具必须自己说出「这是环境问题」**，不能靠人记。
 *
 * 只告警、不阻断（缺依赖不该让 land 失败——账与代码是两件事）；但我把话说到底：
 *   装什么、怎么装、装完重跑什么。
 */
function warnDepsHealth(repo, { quiet = false, worktreePath = null } = {}) {
  // 0.45 T-gm-45-0-03：按 Node 的**向上解析顺序**找依赖（工作区 → 公共父目录 → 主仓）。
  //   只看一个目录会误报：工作区自己没装、但公共父目录有一份 ⇒ Node 能命中，那是真能用。
  //   声明源始终是主仓的 package.json（moduleDirs 只影响「去哪找 node_modules」）。
  const moduleDirs = depsRootsFor({ worktreePath, repo });
  const r = checkDepsHealth({ root: repo, moduleDirs });
  if (r.ok) return r;
  if (!quiet) {
    console.log(out.warn("  ⚠ 依赖健康检查未过（不影响本次动作，但会影响后面跑测试）："));
    for (const m of r.missing.slice(0, 5)) console.log(out.dim(`      · 缺 ${m.name}：${m.why}`));
    for (const m of r.mismatched.slice(0, 5)) console.log(out.dim(`      · ${m.name}：声明 ${m.declared}，装的是 ${m.installed}`));
    console.log(out.dim(`  · ${depsHealthLine(r).replace(/^E_DEPS_MISSING：/, "")}`));
  }
  return r;
}

/** 代码仓根（板配置的 repo；板根通常不是代码仓，不是就直接报错——不猜） */
function codeRepoOf(board) {
  const repo = board.repo && String(board.repo).trim() ? board.repo : board.root;
  return isRepo(repo) ? repo : null;
}

/** 工作区布局：缺省与代码仓同级（<repo>.wt/<任务id>），绝不放进仓库内部 */
function worktreePathOf(repo, args, leaf) {
  const custom = typeof args["worktree-dir"] === "string" && args["worktree-dir"].trim() ? args["worktree-dir"].trim() : null;
  const root = custom || sharedRootForRepo(repo);
  // 0.41：工作单元的目录名 = **单元 id 去掉 req/ 前缀**（路径与分支一一对应 ⇒ 排查时一眼对上）
  return { root: root.split("\\").join("/"), path: join(root, String(leaf)).split("\\").join("/") };
}

/** 当前检出分支（detached 返回空串） */
function currentBranch(dir) {
  const r = runGit(dir, ["symbolic-ref", "--short", "HEAD"]);
  return r.ok ? r.stdout.trim() : "";
}

function doStart(args) {
  const json = args.json === true;
  const taskId = args._?.[0] ? String(args._[0]) : null;
  if (!taskId) {
    console.error(errOut.err("✗ 缺任务 id\n" + USAGE));
    return 1;
  }
  const ttl = args.ttl === undefined ? DEFAULT_LEASE_MINUTES : Number(args.ttl);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    console.error(errOut.err("✗ --ttl 需正数（分钟）"));
    return 1;
  }
  const loc = locate(taskId);
  if (loc.error) return failLoc(loc);
  const board = loc.board;
  const repo = codeRepoOf(board);
  if (!repo) {
    console.error(errOut.err("✗ 板配置的 repo 不是 git 仓库：" + (board.repo ?? "（空）")));
    console.error("  · 板是账根、repo 是代码根；先修 board.yaml 的 repo 行");
    return 1;
  }
  const base = (typeof args.base === "string" && args.base.trim()) || currentBranch(repo) || "main";

  // ⓪ 依赖闸门（0.47 R-gm-104 · T-gm-104-04）——**在认领之前**：
  //   start 是「分支基线确定」的那一刻，早拦省事；而**拦不住的检查不该有副作用**——
  //   别白占 15 分钟租约再报错。越过用独立旗标 `--ignore-deps`，**不复用 `--force`**：
  //   后者已用于认领抢占，一个旗标两种后果 = 「想越过依赖，结果抢了别人的租约」。
  const gate = depGateOf({
    reqId: loc.hit.reqId,
    task: loc.hit.task,
    ledgerTasks: readTaskLedger(board.root, loc.hit.reqId).tasks,
    reqEntries: readReqEntries(board.root),
  });
  const ignoreDeps = args["ignore-deps"] === true;
  /** 越过闸门 = 有阻塞但带了 --ignore-deps（回执 / 事件 / JSON 共用这一个口径） */
  const bypassed = ignoreDeps && !gate.ok;
  if (!gate.ok && !ignoreDeps) {
    console.error(errOut.err(`✗ 依赖未满足，先别开工：${taskId}`));
    for (const line of depGateLines(gate)) console.error(`  · ${line}`);
    console.error(out.dim(`  · 依赖是**开工闸门**：前置 done 才开工（不是 landed——合了没验的产出会把风险传给下游）`));
    console.error(out.dim(`  · 确实要先动（比如只是探路 / 改的是不相干文件）：gd work start ${taskId} --ignore-deps（会落一条事件留痕）`));
    return 1;
  }

  // ① 先拿到认领（同一把板锁内）——两个人不能同时 start 同一任务
  const session = sessionIdFromEnv();
  const claim = claimCore({ board, hit: loc.hit, taskId, executor: args.executor, ttl, session, argsForce: args.force === true });
  if (!claim.ok) {
    console.error(errOut.err("✗ " + claim.error));
    for (const h of claim.hint ?? []) console.error("  · " + h);
    return 1;
  }

  // ② 工作区：**按工作单元**（执行体 × 需求）开，不按任务开（0.41）
  //    · 本执行体在本需求上已有工作单元 ⇒ **复用**（不建工作树、不建分支）：同需求的连续任务共用一棵
  //    · 没有 ⇒ 新建：分支 req/<需求id>（被别的执行体占用时加后缀）
  const reqId = claim.reqId;
  const executor = claim.task.executor;
  const ledger0 = readTaskLedger(board.root, reqId);
  const units0 = Array.isArray(ledger0.workUnits) ? ledger0.workUnits : [];
  let unit = findUnitFor({ units: units0, executor });
  // 别人的工作单元 ⇒ **拒**（不自动迁移、不自动交接：设计稿 §8 风险 2）
  if (!unit) {
    const others = units0.filter((u) => u && u.executor && String(u.executor) !== String(executor));
    if (others.length) {
      console.error(errOut.err(`✗ 需求 ${reqId} 已有 ${others[0].executor} 的工作区（${others[0].branch}）——本执行体不能直接复用`));
      console.error("  · 等对方 land 后再开工，或显式交接（人工确认，工具不自动迁移工作区）");
      return 1;
    }
  }
  const branch = unit ? unit.branch : workUnitId({ reqId, executor, taken: units0 });
  const leaf = branch.replace(/^req\//, "");
  // 单元可能**没记路径**（迁移出来的：旧工作树早没了）⇒ 用规范路径（<repo>.wt/<需求id>）
  const canonical = worktreePathOf(repo, args, leaf);
  const wt = unit && unit.path ? { root: dirname(unit.path), path: unit.path } : canonical;
  let add = { ok: true, stdout: "", stderr: "" };
  const branchExists = () => runGit(repo, ["rev-parse", "--verify", "--quiet", branch]).ok;
  if (existsSync(wt.path)) {
    // ① 工作树还在 ⇒ 直接接着用（同需求连续任务不重建、不重装依赖）
    add = { ok: true, stdout: "", stderr: "" };
  } else if (branchExists()) {
    // ② 工作树没了但分支在 ⇒ 从分支重建（不丢已提交的工作）
    mkdirSync(wt.root, { recursive: true });
    add = runGit(repo, ["worktree", "add", wt.path, branch]);
    if (!add.ok) {
      console.error(errOut.err("✗ 工作树没了、分支也在但拉不回来：" + branch + "——" + (add.stderr || "").trim()));
      console.error("  · 手工来：git worktree add " + wt.path + " " + branch);
      return 1;
    }
  } else if (unit) {
    // ③ 单元在、分支不在（如刚迁移出来的）⇒ 按单元的 branch 新建
    mkdirSync(wt.root, { recursive: true });
    add = runGit(repo, ["worktree", "add", "-b", branch, wt.path, base]);
  } else {
    // ④ 全新单元
    mkdirSync(wt.root, { recursive: true });
    add = runGit(repo, ["worktree", "add", "-b", branch, wt.path, base]);
  }
  if (!add.ok) {
    // 最常见的成因是「仓里一个提交都没有」（基线 ref 不存在）——给明确出路，别把 git 原始报错甩给人
    if (!runGit(repo, ["rev-parse", "--verify", "--quiet", "HEAD"]).ok) {
      console.error(errOut.err(`✗ 建工作区失败：这个仓还没有任何提交（${base} 不存在）`));
      console.error("  · 隔离工作区要从某个基线切分支；先做首个提交：git add -A && git commit -m init");
    } else {
      console.error(errOut.err("✗ 建工作区失败：" + (add.stderr || add.stdout)));
    }
    return 1;
  }

  // B-gm-000010：建完先查一次「指向外部的联接」——junction 会被回收时的递归删除穿透。
  //   这里只提示不阻断（阻断留给 land 的硬拦），但**把话说清楚**：别建联接，要依赖就本地装。
  {
    const links = findExternalLinks(wt.path);
    if (links.length) {
      console.log(out.warn(`  ⚠ 工作区里有 ${links.length} 个指向外部的联接（回收时会先摘掉，勿用来共享目录）：`));
      for (const l of links) console.log(out.dim(`    · ${l.path} → ${l.target}`));
      console.log(out.dim("    · 需要依赖就在工作区里本地装（npm ci）——别用联接/junction 共享 node_modules"));
    }
  }

  // ③ 记账：工作单元落**需求任务账顶层**（work_units[]），任务只留**引用**（work_unit）
  const nowIso = new Date().toISOString();
  const unitRec = {
    id: branch,
    executor,
    branch,
    path: wt.path,
    base,
    repo: repo.split("\\").join("/"),
    started: unit ? unit.started ?? nowIso : nowIso,
    session: unit ? unit.session ?? session : session,
    tasks: [...new Set([...(unit?.tasks ?? []), taskId])],
  };
  const rec = mutateTaskLedger(board.root, reqId, (l) => {
    const units = (Array.isArray(l.workUnits) ? l.workUnits : []).filter((u) => String(u.id) !== branch);
    const tasks = l.tasks.map((t) => (String(t.id) === taskId ? { ...t, work_unit: branch } : t));
    return { ...l, tasks, workUnits: [...units, unitRec] };
  });
  if (!rec) {
    console.error(errOut.err("✗ 工作单元记账失败"));
    return 1;
  }
  appendEvents(board.root, claim.reqId, [
    // 越过依赖闸门必须留痕（谁、越过了哪几条）——不然「闸门被绕过」这件事在账上完全看不见
    ...(bypassed
      ? [
          {
            kind: "note",
            actor: claim.task.executor,
            task: taskId,
            text:
              `越过依赖闸门（--ignore-deps）：在等 ${gate.blocked.map((b) => `${b.id}(${b.status || "未知"})`).join(" / ")}` +
              (gate.dangling.length ? `；悬空边 ${gate.dangling.join(" / ")}` : ""),
          },
        ]
      : []),
    {
      kind: "progress",
      actor: claim.task.executor,
      task: taskId,
      state: "working",
      text: (unit ? "接着用工作区：" : "开工作区：") + branch + " @ " + wt.path + "（基线 " + base + "）",
    },
  ]);

  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          task: taskId,
          workUnit: branch,
          reused: Boolean(unit),
          branch,
          path: wt.path,
          base,
          repo,
          executor,
          session,
          deps: { total: gate.total, blocked: gate.blocked, dangling: gate.dangling, bypassed },
        },
        null,
        2
      )
    );
    return 0;
  }
  console.log(out.ok("✅ 已开工 " + taskId));
  console.log("  分支：" + branch + "   基线：" + base);
  console.log("  工作区：" + wt.path);
  if (bypassed) {
    console.log(out.warn(`  ⚠ 已越过依赖闸门（--ignore-deps）：在等 ${gate.blocked.map((b) => b.id).join(" / ")}`));
    console.log(out.dim("    · 已落一条事件留痕；前置完成后记得回来核一遍产出"));
  }
  console.log(out.dim('  · 进这块工作区改代码：cd "' + wt.path + '"'));
  console.log(out.dim("  · 提交并 rebase：gd work submit " + taskId + "   · 合入基线：gd work land " + taskId));
  // 0.45 哨兵：隔离工作区常是新的（没装依赖）⇒ 说清「要跑测试先装」，别让人跑出一片环境红
  warnDepsHealth(repo, { worktreePath: wt.path });
  return 0;
}

function doSubmit(args) {
  const json = args.json === true;
  const taskId = args._?.[0] ? String(args._[0]) : null;
  if (!taskId) {
    console.error(errOut.err("✗ 缺任务 id\n" + USAGE));
    return 1;
  }
  const loc = locate(taskId);
  if (loc.error) return failLoc(loc);
  const board = loc.board;
  const ledger = readTaskLedger(board.root, loc.hit.reqId);
  const task = ledger.tasks.find((t) => t.id === taskId);
  // 0.41：工作区来自**工作单元**（任务只引用它）；旧账的任务自带 work 块 ⇒ 兼容读（就地当单任务单元）
  const resolved = unitOfTask({ units: ledger.workUnits, task });
  if (resolved.missing) {
    console.error(errOut.err("✗ 任务 " + taskId + " 引用的工作单元 " + resolved.ref + " 不在账里（被删/迁移丢失）——重新 gd work start"));
    return 1;
  }
  const work = resolved.unit;
  if (!work || !work.path) {
    console.error(errOut.err("✗ 任务 " + taskId + " 还没开工——先 gd work start " + taskId));
    return 1;
  }
  if (!existsSync(work.path) || !isRepo(work.path)) {
    console.error(errOut.err("✗ 工作区不存在或不是 git 仓库：" + work.path + "——重跑 gd work start " + taskId));
    return 1;
  }

  // ① 精确路径提交（永不 add -A）：脏路径逐个列出后显式 add
  const dirty = porcelainPaths(work.path);
  let commit = { status: "nochange", hash: null };
  if (dirty.length > 0) {
    const summary = (typeof args.message === "string" && args.message.trim()) || taskId + " " + String(task.title ?? "").trim();
    const message = buildCommitMessage({
      type: "chore",
      scope: "task", // 提交契约白名单词（任务 id 走 trailer）
      summary: summary.slice(0, 60),
      trailers: { 任务: taskId, 提交人: String(task.executor ?? "") || DEFAULT_EXECUTOR },
    });
    const c = commitFiles(work.path, { message, paths: dirty });
    if (!c.ok) {
      console.error(errOut.err("✗ 提交失败：" + (c.errors ?? []).join(" / ")));
      return 1;
    }
    commit = c.nochange ? { status: "nochange", hash: null } : { status: "ok", hash: c.hash, files: dirty.length };
  }

  // ② rebase 到基线（串行化的前提）。
  //   0.45 T-gm-45-0-01 改了三处（都是实测踩出来的）：
  //     ① 中间态先拒绝：上次冲突没解完就再 rebase，只会把已经很脆的状态搅得更乱；
  //     ② **免编辑器**（`-c core.editor=true`）：`rebase --continue` 会弹编辑器，无头会话能卡几分钟；
  //     ③ 冲突**不回滚**：中止会把「已经解了一半」的上下文一起扔掉，人只能从零重来。
  //        改成停在中间态、把四步给全，由人决定「继续解」还是「放弃」。
  if (rebaseInProgress(work.path)) {
    console.error(errOut.err("✗ 工作区正处于 rebase 中间态（上次冲突还没解完）——先处理完再 submit"));
    console.error('  · 继续解：cd "' + work.path + '" → git status → 解冲突 → git add <文件> → GIT_EDITOR=true git rebase --continue');
    console.error('  · 放弃：cd "' + work.path + '" && git rebase --abort');
    return 1;
  }
  const rb = runGit(work.path, ["-c", "core.editor=true", "rebase", work.base]);
  if (!rb.ok) {
    console.error(errOut.err("✗ rebase 到 " + work.base + " 冲突 —— **已停在这里等你解**（没有回滚，冲突中间态全留着）"));
    console.error('  · 1) cd "' + work.path + '"');
    console.error("  · 2) git status 看冲突文件 → 逐个解 → git add <文件>");
    console.error("  · 3) GIT_EDITOR=true git rebase --continue   （不加 GIT_EDITOR 会弹编辑器，无头会话会卡住）");
    console.error("  · 4) 再跑 gd work submit " + taskId + " → gd work land " + taskId);
    console.error('  · 想放弃：cd "' + work.path + '" && git rebase --abort（回到 submit 之前的状态，不丢提交）');
    console.error(out.dim((rb.stderr || rb.stdout).split("\n").slice(0, 3).join(" / ")));
    return 1;
  }
  const head = runGit(work.path, ["rev-parse", "--short", "HEAD"]).stdout.trim();
  // 分支相对基线**还有几个提交没合入** —— 这决定「下一步有没有事可做」。
  //   过去的说法是「无改动（仅 rebase）」，把「这次没有新改动」和「上次的改动还没落地」混成一句，
  //   人会以为没事可做（实测因此重跑了三轮 submit / land）。
  const aheadRaw = runGit(work.path, ["rev-list", "--count", work.base + "..HEAD"]);
  const ahead = Number(String(aheadRaw.stdout ?? "").trim()) || 0;

  const rec = patchTask(board, loc.hit.reqId, taskId, (t) => ({
    ...t,
    submitted: { at: new Date().toISOString(), head, base: work.base, committed: commit.status === "ok", files: commit.files ?? 0 },
  }));
  if (!rec.ok) {
    console.error(errOut.err("✗ " + rec.error));
    return 1;
  }
  appendEvents(board.root, loc.hit.reqId, [
    {
      kind: "progress",
      actor: String(task.executor ?? "") || DEFAULT_EXECUTOR,
      task: taskId,
      state: "working",
      text: "submit：" + (commit.status === "ok" ? "提交 " + commit.hash : "无改动") + " · rebase 到 " + work.base + " · head " + head,
    },
  ]);

  if (json) {
    console.log(JSON.stringify({ ok: true, task: taskId, commit, head, base: work.base, path: work.path }, null, 2));
    return 0;
  }
  console.log(out.ok("✅ 已提交并 rebase 到 " + work.base + "（head " + head + "）"));
  // 「这次没新改动」与「上次的改动还没落地」是两件事 —— 分开说，否则人会以为没事可做
  if (commit.status === "ok") console.log("  提交 " + commit.hash + "（" + commit.files + " 个文件）");
  else if (ahead > 0) console.log(out.warn("  本次无新改动，但分支相对 " + work.base + " 还有 " + ahead + " 个提交未合入"));
  else console.log("  无新改动（分支已与 " + work.base + " 齐平，没有待合入的提交）");
  const nextHint = ahead > 0 && commit.status !== "ok" ? "（先把上次那个提交落了）" : "";
  console.log(out.dim("  · 合入基线：gd work land " + taskId + nextHint));
  return 0;
}

/** land 追基线重试次数：基线被别人推进时自动追平再试，不必让人手工重跑 */
const LAND_ATTEMPTS = 3;

/** 工作区是否正处在 rebase 中间态（上次冲突没解完）—— 中间态里再 rebase 会把状态搅乱 */
function rebaseInProgress(dir) {
  const gd = runGit(dir, ["rev-parse", "--git-dir"]);
  if (!gd.ok) return false;
  const gdPath = String(gd.stdout || "").trim();
  if (!gdPath) return false;
  const abs = isAbsolute(gdPath) ? gdPath : join(dir, gdPath);
  return existsSync(join(abs, "rebase-merge")) || existsSync(join(abs, "rebase-apply"));
}

function doLand(args) {
  const json = args.json === true;
  const ids = (args._ ?? []).map((x) => String(x)).filter(Boolean);
  if (!ids.length) {
    console.error(errOut.err("✗ 缺任务 id（可给多个：一次板锁合多分支）\n" + USAGE));
    return 1;
  }
  const loc0 = locate(ids[0]);
  if (loc0.error) return failLoc(loc0);
  const board = loc0.board;

  // ── 逐个任务 → 解析出**工作单元**（同一单元只合一次）─────────────────────────
  const units = []; // { unit, base, path, branch, taskIds }
  const byUnit = new Map();
  for (const taskId of ids) {
    const loc = taskId === ids[0] ? loc0 : locate(taskId);
    if (loc.error) return failLoc(loc);
    const ledger = readTaskLedger(board.root, loc.hit.reqId);
    const task = ledger.tasks.find((t) => t.id === taskId);
    if (!task) {
      console.error(errOut.err(`✗ 任务 ${taskId} 不在 ${loc.hit.reqId} 的账里`));
      return 1;
    }
    const submitted = ledgerBlock(task.submitted);
    const resolved = unitOfTask({ units: ledger.workUnits, task });
    if (resolved.missing) {
      console.error(errOut.err("✗ 任务 " + taskId + " 引用的工作单元 " + resolved.ref + " 不在账里——重新 gd work start"));
      return 1;
    }
    const work = resolved.unit;
    if (!work || !work.path) {
      console.error(errOut.err("✗ 任务 " + taskId + " 没有工作区——先 gd work start / submit"));
      return 1;
    }
    // 工作区卡在 rebase 中间态（上次冲突没解完）时，**先说这件事** —— 它比「还没交件」更可行动：
    //   不处理完，后面每条命令都只会在同一个死结上报错。
    if (rebaseInProgress(work.path)) {
      console.error(errOut.err("✗ 工作区 " + work.id + " 正处于 rebase 中间态（上次冲突没解完）"));
      console.error('  · 继续解：cd "' + work.path + '" → git status → 解冲突 → git add <文件> → GIT_EDITOR=true git rebase --continue');
      console.error('  · 或放弃：cd "' + work.path + '" && git rebase --abort（回到冲突之前，不丢提交）');
      return 1;
    }
    // 闸门①（逐任务）：这个任务自己还没交件 ⇒ 拒（比单元闸门更具体，先说它）
    if (!submitted) {
      console.error(errOut.err("✗ 任务 " + taskId + " 还没 submit——先 gd work submit " + taskId));
      return 1;
    }
    // 闸门②（工作单元）：单元里**其它**任务还没交件 ⇒ 拒（别把别人的活顺带带进基线）
    if (args.force !== true) {
      const pending = unitUnsubmitted({ unit: work, tasks: ledger.tasks });
      if (pending.length) {
        console.error(errOut.err("✗ 该工作单元（" + work.branch + "）还有未交件的任务：" + pending.join(" / ") + "——先逐个 gd work submit"));
        console.error("  · 确实要提前落：gd work land " + taskId + " --force（留痕）");
        return 1;
      }
    }
    const key = String(work.id);
    if (byUnit.has(key)) {
      const exist = byUnit.get(key);
      exist.taskIds.push(taskId);
      if (args.force === true) {
        const rest = unitUnsubmitted({ unit: work, tasks: ledger.tasks });
        if (rest.length && !exist.forceNote) exist.forceNote = "--force 越过单元交件闸门（未交件：" + rest.join(" / ") + "）";
      }
    }
    else {
      const pendingRest = unitUnsubmitted({ unit: work, tasks: ledger.tasks });
      const u = {
        unit: key,
        base: work.base,
        path: work.path,
        branch: work.branch,
        taskIds: [taskId],
        // B-gm-000049：**单元成员**（`work_units[].tasks`）与「命令行点名」是两件事。
        //   回写 `landed` 时按成员算，不按参数算——否则同单元里没被点名的已交件任务永远没有 `landed`，
        //   而 `work sweep` 用 `!t.landed` 判「还开着」⇒ 清扫永远清不掉（连跑两轮报同一批）。
        unitTasks: Array.isArray(work.tasks) ? work.tasks.map(String) : [],
        reqId: loc.hit.reqId, // 回写账要落到**各自的**需求账：合批可以跨需求
        ledger,
        // --force 越闸**必须留痕**：越闸这件事本身要被审计出来，否则「能越」就等于「没有闸门」
        forceNote: args.force === true && pendingRest.length ? "--force 越过单元交件闸门（未交件：" + pendingRest.join(" / ") + "）" : null,
      };
      byUnit.set(key, u);
      units.push(u);
    }
  }

  const repo = codeRepoOf(board);
  if (!repo) {
    console.error(errOut.err("✗ 板配置的 repo 不是 git 仓库：" + (board.repo ?? "（空）")));
    return 1;
  }
  const cur = currentBranch(repo);
  if (units.some((u) => u.base !== units[0].base)) {
    console.error(errOut.err("✗ 这些工作单元的基线不一致（" + units.map((u) => u.base).join(" / ") + "）——分批 land"));
    return 1;
  }
  const base = units[0].base;
  if (cur !== base) {
    console.error(errOut.err("✗ 代码仓当前在 " + (cur || "detached") + "，land 需要它在 " + base + " 上"));
    console.error('  · 先切回：cd "' + repo + '" && git checkout ' + base);
    return 1;
  }
  // ── T-45-0-01：合批**预检**（只读）——动手之前先看「谁和谁撞、撞在哪」────────
  //   两类撞车分开说（input 的 A / B）+ 主树脏文件（C 由 T-45-0-06 引入，这里并进同一张表）。
  //   措辞纪律：文件级重叠只说「可能撞」，不说「冲突」——真正的裁判是 git。
  const dirtyTracked = runGit(repo, ["status", "--porcelain", "--untracked-files=no"]);
  const dirtyPaths = dirtyTracked.ok
    ? String(dirtyTracked.stdout || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.replace(/^[A-Z?!]{1,2}\s+/, ""))
        .map((p) => p.split(" -> ").pop())
        .filter(Boolean)
    : [];
  const pf = preflight({ repo, base, units: units.map((u) => ({ unit: u.unit, branch: u.branch })), dirty: dirtyPaths });
  if (!json) {
    // ① T-45-0-06 的原样输出**一律保留**：主树有未提交改动 ⇒ 「谁在挡」+ mtime + 处置。
    //    这是另一条任务已经交付并被人认可的行为，不能因为 01 引入预检就把它替换掉。
    const rows = dirtyPaths.filter((f) => f && !f.startsWith("core/closure.json"));
    if (rows.length) {
      const now = Date.now();
      const describe = (rel) => {
        const abs = join(repo, rel);
        let mins = null;
        try {
          mins = Math.round((now - statSync(abs).mtimeMs) / 60000);
        } catch {
          mins = null;
        }
        const hint = mins === null ? "" : mins <= 10 ? ` · **${mins} 分钟内还在写**` : ` · ${mins} 分钟前`;
        return `      · ${rel}${hint}`;
      };
      console.log(out.warn(`  ⚠ 主工作区有 ${rows.length} 个未提交改动——它们**不属于本任务**，但会让合入被拒：`));
      for (const r of rows.slice(0, 8)) console.log(describe(r));
      if (rows.length > 8) console.log(out.dim(`      · ……另有 ${rows.length - 8} 个`));
      console.log(out.dim("  · 处置：别人的活别碰（让路 / 等他提交）；自己的活先提交；都没有就让持有者归档后再 land"));
      console.log(out.dim("  · 本条只提示不阻断：真挡上了 git 会给明确报错，这里只是把「谁在挡」提前说清"));
    }
    // ② 合批预检的增量：多单元时才说「谁和谁撞」；单单元时只在**撞上了**才补一句
    //    （单单元 + 主树脏的情形 ① 已经说清，再重复一遍就是噪音）。
    const wantCollisions = pf.collisions.length > 0;
    const wantBlockedDetail = pf.blockedByMainTree.length > 0 && rows.length === 0;
    if (units.length > 1 || wantCollisions || wantBlockedDetail) {
      for (const l of preflightLines(pf)) console.log(l.startsWith("✅") ? out.dim(l) : out.warn(l.startsWith("⚠") ? l : "  " + l));
    }
  }

  // ── 串行合入：**一次板锁合多分支** ─────────────────────────────────────────
  //   锁内做「追基线 → 快进合入」，两个 land 不会同时 rebase/merge。
  //   基线被别人抢先推进 ⇒ 自动重新追平再试（最多 LAND_ATTEMPTS 次），不让人手工重跑。
  //   冲突则**停在 rebase 中间态**（不 abort）：把人要解的东西留着，四步全给出来。
  const results = [];
  withBoardLock(
    board.root,
    () => {
      for (const u of units) {
        let lastMergeErr = "";
        let done = null;
        for (let attempt = 1; attempt <= LAND_ATTEMPTS; attempt++) {
          const rb = runGit(u.path, ["-c", "core.editor=true", "rebase", base]);
          if (!rb.ok) {
            done = { ok: false, kind: "conflict", attempt, detail: rb.stderr || rb.stdout };
            break;
          }
          const m = runGit(repo, ["merge", "--ff-only", u.branch]);
          if (m.ok) {
            done = { ok: true, attempt };
            break;
          }
          lastMergeErr = m.stderr || m.stdout; // 基线又前进 ⇒ 下一轮重新追平再试
        }
        if (!done) done = { ok: false, kind: "exhausted", attempts: LAND_ATTEMPTS, detail: lastMergeErr };
        done.head = runGit(repo, ["rev-parse", "--short", "HEAD"]).stdout.trim();
        results.push(done);
        if (!done.ok) break; // 一个失败就停：后面的单元基线还没对齐，继续合只会更难查
      }
    },
    { timeoutMs: 60_000, staleMs: 300_000 }
  );

  const bad = results.findIndex((r) => !r.ok);
  if (bad >= 0) {
    const [r, u] = [results[bad], units[bad]];
    if (r.kind === "conflict") {
      console.error(errOut.err(`✗ ${u.unit} 追基线 ${base} 时冲突 —— **已停在这里等你解**（没有回滚，冲突中间态全留着）`));
      console.error('  · 1) cd "' + u.path + '"');
      console.error("  · 2) git status 看冲突文件 → 逐个解 → git add <文件>");
      console.error("  · 3) GIT_EDITOR=true git rebase --continue   （不加 GIT_EDITOR 会弹编辑器，无头会话会卡住）");
      console.error("  · 4) gd work submit " + u.taskIds[0] + " → 再 gd work land " + u.taskIds.join(" "));
      console.error("  · 想放弃：cd \"" + u.path + '" && git rebase --abort（回到 land 之前的状态，不丢提交）');
      console.error(out.dim(String(r.detail ?? "").split("\n").slice(0, 3).join(" / ")));
      return 1;
    }
    console.error(errOut.err(`✗ ${u.unit} 连续 ${r.attempts} 次追基线后仍无法快进合入（基线被持续推进）`));
    console.error(out.dim(String(r.detail ?? "").split("\n").slice(0, 3).join(" / ")));
    console.error("  · 频繁撞车时让另一侧先 land 完；或 gd work submit 后再 land");
    return 1;
  }
  // 已经合入的单元 → 回写账 + 回收 + 事件（逐个）
  const landedRows = [];
  for (let k = 0; k < units.length; k++) {
    const u = units[k];
    const r = results[k];
    const work = { id: u.unit, path: u.path, branch: u.branch, base: u.base, ledger: u.ledger };
    if (r.attempt > 1) console.log(out.dim(`  · ${u.unit} 的基线被推进过，已自动追平并合入（第 ${r.attempt} 次尝试）`));
    const head = r.head;

    const cleanup = { worktree: "kept", branch: "kept" };
    // 0.21.15（R-gm-039）：**回收前先看人在哪儿**——shell 的 cwd 若落在被回收的工作区内，
    //   回收后 cwd 指向已删除目录 ⇒ 后续 `handoff` / `check` 全部「未定位到板」（实测踩过）。
    const cwdInside = cwdWithin(work.path);
    if (args.keep !== true && !cwdInside) {
      // B-gm-000010（blocker）：**回收前先摘掉指向外部的联接** ——
      //   git worktree remove --force 的递归删除会**穿透 junction**（把 junction 当普通目录），
      //   结果是「目标目录还在、里面的内容被清空」（实测：主仓 node_modules 的 91 个包被删）。
      //   Node 的 rmSync 只删链接本身、不碰目标 ⇒ 先摘链接，再让 git 回收。
      const links = findExternalLinks(work.path);
      for (const l of links) {
        if (unlinkLink(l.path)) {
          console.log(out.dim(`  · 已摘掉指向外部的联接（防回收时穿透）：${l.path} → ${l.target}`));
        } else {
          console.error(errOut.err(`✗ 摘不掉指向外部的联接：${l.path} → ${l.target}`));
          console.error("  · 手动删掉这个联接（或把它挪进工作区内部）再重试 gd work land；");
          console.error("  · 为安全起见**本次不回收工作区**（工作区保留，代码不丢）。");
          cleanup.worktree = "kept-unsafe-link";
          cleanup.worktreeError = `E_UNSAFE_LINK ${l.path}`;
          break;
        }
      }
      if (cleanup.worktree !== "kept-unsafe-link") {
        const rm = runGit(repo, ["worktree", "remove", "--force", work.path]);
        if (rm.ok) cleanup.worktree = "removed";
        else cleanup.worktreeError = failReason(rm);
        const del = runGit(repo, ["branch", "-d", work.branch]);
        if (del.ok) cleanup.branch = "deleted";
        else cleanup.branchError = failReason(del);
      }
    } else if (cwdInside) {
      cleanup.worktree = "kept-in-cwd";
    }
    const cleanupNote = [
      `工作区 ${cleanup.worktree}`,
      `分支 ${cleanup.branch}`,
      ...["worktreeError", "branchError"].filter((key) => cleanup[key]).map((key) => `原因 ${cleanup[key]}`),
    ].join(" · ");
    // 单元里**已交件**的任务一律记 landed（合批时一个单元可能承载多个任务）
    //   B-gm-000049：原来只遍历 `u.taskIds`（= 命令行点名的那些），注释写的是「单元里已交件的一律记」，
    //     实现只记了点名的那个 ⇒ 同单元其余已交件任务永远没有 `landed`，而 `work sweep` 用 `!t.landed`
    //     判「这个单元还开着」⇒ 清扫永远清不掉，连跑两轮报同一批。
    //   判据 = **单元成员 ∩ 已交件**（成员真相源是 `work_units[].tasks`，不是命令行参数）：
    //     · 未交件的成员**不许**记（--force 提前落时它还没合进基线，记了就是把别人的活说成已归档）
    //     · 点名的任务**必须**记（哪怕它漏绑了单元——那是账的问题，不能让它的 landed 一起丢）
    const submitted = new Set(u.ledger.tasks.filter((t) => ledgerBlock(t.submitted)).map((t) => String(t.id)));
    const memberLanded = u.unitTasks.filter((tid) => submitted.has(String(tid)));
    const landedIds = [...new Set([...u.taskIds, ...memberLanded])];
    for (const tid of landedIds) {
      const rec = patchTask(board, u.reqId, tid, (t) => ({
        ...t,
        landed: { at: new Date().toISOString(), base, head, cleanup },
      }));
      if (!rec.ok) {
        console.error(errOut.err("✗ " + rec.error));
        return 1;
      }
    }
    appendEvents(board.root, u.reqId, [
      {
        kind: "progress",
        actor: String(units[k].ledger.tasks.find((t) => t.id === u.taskIds[0])?.executor ?? "") || DEFAULT_EXECUTOR,
        task: u.taskIds[0],
        text: `land：${work.branch} 快进合入 ${base}（head ${head} · ${cleanupNote}）${u.forceNote ? " · **" + u.forceNote + "**" : ""}`,
      },
    ]);
    landedRows.push({
      unit: u.unit,
      branch: work.branch,
      base,
      head,
      cleanup,
      taskIds: landedIds,
      path: u.path,
      worktree: cleanup.worktree,
    });
  }

  if (json) {
    console.log(JSON.stringify({ ok: true, base, landed: landedRows, preflight: pf }, null, 2));
    return 0;
  }
  for (const row of landedRows) {
    console.log(out.ok(`✅ ${row.unit} 已合入 ${row.base}（head ${row.head}）`));
    console.log(
      "  工作区：" + (row.cleanup.worktree === "removed" ? "已回收" : "保留（" + row.path + "）") + "   分支：" + (row.cleanup.branch === "deleted" ? "已删除" : "保留（" + row.branch + "）")
    );
    if (row.cleanup.worktreeError) {
      console.log(out.warn("  · 工作区未回收：" + row.cleanup.worktreeError));
      console.log(out.dim('  · 手动回收：gd work sweep --apply（或 git worktree remove --force "' + row.path + '"）'));
    }
    if (row.cleanup.branchError) console.log(out.warn("  · 分支未删除：" + row.cleanup.branchError));
    if (row.cleanup.worktree === "kept-in-cwd") {
      // 「这个工作区里」不能省成「里面」：读者要一眼看出**当前目录本身**就在工作区内（R-gm-59-0 文案回归）
      console.log(out.warn("  · 工作区已保留：你的当前目录就在这个工作区里（回收会让 shell 的 cwd 变成已删除目录）"));
      // 交接必须在本工作区跑：任务有工作单元 ⇒ handoff / check 有分支闸门，回主仓会报「不可交件」（B-gm-000037）
      console.log(out.dim("  · 交接就在本工作区跑：gd handoff / gd check —— 工作单元在 " + row.branch + "，回主仓交件会被分支闸门拒"));
      console.log(out.dim("  · 全部收尾后再 cd \"" + repo + "\"；工作区用 gd work sweep --apply 回收"));
    }
  }
  if (landedRows.length > 1) console.log(out.dim(`  · 一次板锁合了 ${landedRows.length} 个工作单元`));
  console.log(out.dim("  · 任务仍在 in_progress：交付/验收走 handoff / check（席位模式 gd seat task handoff）"));
  return 0;
}

function doRelease(args) {
  const json = args.json === true;
  const taskId = args._?.[0] ? String(args._[0]) : null;
  if (!taskId) {
    console.error(errOut.err(`✗ 缺任务 id\n${USAGE}`));
    return 1;
  }
  const loc = locate(taskId);
  if (loc.error) return failLoc(loc);
  const { board, hit } = loc;
  const session = sessionIdFromEnv();

  return withBoardLock(board.root, () => {
    const ledger = readTaskLedger(board.root, hit.reqId);
    const task = ledger.tasks.find((t) => t.id === taskId);
    if (!task) {
      console.error(errOut.err(`✗ 任务 ${taskId} 不在 ${hit.reqId} 账内`));
      return 1;
    }
    const existing = claimOf(task);
    if (!existing) {
      if (json) {
        console.log(JSON.stringify({ ok: true, task: taskId, released: false, reason: "本就未认领" }, null, 2));
        return 0;
      }
      console.log(out.dim(`· 任务 ${taskId} 本就未认领，无需交还`));
      return 0;
    }
    const mine = existing.session === session;
    if (!mine && args.force !== true) {
      console.error(errOut.err(`✗ 任务 ${taskId} 被 ${describeClaim(existing)} 持有——非持有者交还需 --force（审计留痕）`));
      return 1;
    }
    const next = { ...task };
    delete next.claim;
    if (next.status === "in_progress") next.status = "ready";
    const tasks = ledger.tasks.map((t) => (t.id === taskId ? next : t));
    // 0.45 B-gm-000015：**交还就把它从工作单元的 tasks[] 里摘掉**。
    //   不摘的后果（实测）：release 后任务仍是「单元里的未交件任务」⇒ 单元闸门永远挡着，
    //   该单元上任何 land 都被「还有未交件」拒（而提示里的 --force 当时还没登记，等于整条线卡死）。
    //   语义上也对：单元只承载「正在做 / 已交件」的任务，交还回池的活不属于任何单元。
    const unitRef = String(task.work_unit ?? "").trim();
    const workUnits = (ledger.workUnits ?? []).map((u) =>
      unitRef && String(u.id) === unitRef ? { ...u, tasks: (u.tasks ?? []).filter((x) => String(x) !== taskId) } : u,
    );
    writeTaskLedger(board.root, hit.reqId, { req: ledger.req, tasks, work_units: workUnits }, { expectedRev: ledger.revision });
    appendEvents(board.root, hit.reqId, [
      {
        kind: "release",
        actor: String(task.executor ?? "") || DEFAULT_EXECUTOR,
        task: taskId,
        text: `${mine ? "持有者" : "非持有者 --force"}交还（原持有 ${existing.session}@${existing.host ?? "-"}）${task.status !== next.status ? ` · ${task.status} → ${next.status}` : ""}`,
      },
    ]);

    if (json) {
      console.log(JSON.stringify({ ok: true, task: taskId, released: true, forced: !mine, status: next.status }, null, 2));
      return 0;
    }
    console.log(out.ok(`✅ 已交还 ${taskId}${mine ? "" : "（--force）"}${task.status !== next.status ? ` · ${task.status} → ${next.status}` : ""}`));
    return 0;
  });
}

function doList(args) {
  const json = args.json === true;
  const rb = resolveBoard({ cwd: process.cwd() });
  if (!rb.board || rb.board.error) {
    console.error(errOut.err(`✗ 未定位到板（${rb.board?.error ?? "三处皆无"}）——先 gd core init`));
    return 1;
  }
  const board = rb.board;
  const rows = [];
  // 0.49.6（F1）：工作单元也要列——与「占用」是两件事：占用 = 谁此刻在干哪个任务（任务级租约），
  //   单元 = 代码隔离的落点（执行体 × 需求：一棵工作树 + 一条分支）。设计稿附录 A.4 承诺过这个读面，
  //   缺了它就只能靠 `gd work sweep` 或直读账才发现「这台机器上有哪些工作树」——排查时要多点探查。
  const unitRows = [];
  const includeClosed = args.all === true;
  // 逐需求扫账（板内需求数量级 = 十几个，直扫足够）
  const reqsDir = join(board.root, "reqs");
  const reqIds = existsSync(reqsDir) ? readdirSync(reqsDir).filter((d) => isReqDir(d)) : [];
  for (const reqId of reqIds) {
    const ledger = readTaskLedger(board.root, reqId);
    for (const u of ledger.workUnits ?? []) {
      unitRows.push({
        unit: u.id,
        req: reqId,
        executor: u.executor || "",
        branch: u.branch,
        path: u.path || "",
        base: u.base || "",
        started: u.started ?? null,
        landed: u.landed ?? null,
        tasks: u.tasks ?? [],
      });
    }
    for (const t of ledger.tasks) {
      // 已收尾（done / review）不再算"占用中"——它们的历史 claim 只作审计留痕，`--all` 才展示
      const isClosed = t.status === "done" || t.status === "review";
      if (isClosed && !includeClosed) continue;
      if (!isClosed && !t.claim && t.status !== "in_progress") continue;
      const c = claimOf(t);
      rows.push({
        task: t.id,
        req: reqId,
        executor: t.executor || "",
        status: t.status,
        session: c?.session ?? null,
        host: c?.host ?? null,
        since: c?.since ?? null,
        heartbeat: c?.heartbeat ?? null,
        expired: c ? isClaimExpired(c) : null,
      });
    }
  }
  if (json) {
    console.log(JSON.stringify({ ok: true, board: board.id, mode: board.mode, lease_minutes: DEFAULT_LEASE_MINUTES, tasks: rows, units: unitRows }, null, 2));
    return 0;
  }
  // 工作单元段（缺省就打；与占用段互不影响——没有占用时单元照样要看得见）
  if (unitRows.length > 0) {
    console.log(`板 ${board.id} · 工作单元 ${unitRows.length} 个（「执行体 × 需求」一棵工作树 + 一条分支）`);
    console.log("   单元                        执行体      任务  路径 / 状态");
    for (const u of unitRows) {
      const state = u.landed ? "已合入 · 待回收（gd work sweep --apply）" : `进行中 · ${u.branch}`;
      console.log(`   ${u.unit.padEnd(27)} ${(u.executor || "-").padEnd(11)} ${String(u.tasks.length).padEnd(5)} ${u.path || "—"} · ${state}`);
    }
    console.log(out.dim("  · 合入：gd work land <任务id>（单元内任务全部交件后）· 收掉久未动的：gd work sweep"));
  }
  if (rows.length === 0) {
    console.log(out.dim(unitRows.length === 0 ? `板 ${board.id}：当前没有任务被占用（全部在待办池）` : "  · 当前没有任务被占用（工作单元见上）"));
    return 0;
  }
  console.log(`板 ${board.id} · 占用中 ${rows.length} 条（租约 ${DEFAULT_LEASE_MINUTES} 分钟，过期即可被抢${includeClosed ? " · 含已收尾" : ""}）`);
  console.log("   任务              负责人      状态          占用（会话@宿主 · 心跳 / 租约）");
  for (const r of rows) {
    const claim = !r.session ? "—" : `${r.session}${r.host ? `@${r.host}` : ""}${r.expired ? " · 已过期" : ""}`;
    console.log(`   ${r.task.padEnd(17)} ${(r.executor || "-").padEnd(11)} ${r.status.padEnd(13)} ${claim}`);
  }
  return 0;
}


/**
 * `gd work next` —— 按**身份 + 版本线**从池子里领下一个任务（0.21.6）
 *
 * 多会话日常用它代替"查 list → 复制任务 id"：
 *   ① 先看我名下**已认领且在有效期**的任务（续作优先，避免领到新活却把旧活晾着）；
 *   ② 再按优先级取 ready 任务：我的版本线 > 未认领的线 > （跳过他人线，闸门会拒）；
 *      同一优先级内：有派单给我/未派 > 派给别人；同分按任务 id 升序（稳定可预测）。
 *   ③ `--claim` 一步到位认领（走同一 claimCore，竞态仍由锁与 `E_CLAIMED` 兜底）。
 *
 * 池空时 exit 0 + 明确回报（`--json` 给 `{ok:true, task:null}`），便于脚本循环而不误判失败。
 */
function doNext(args) {
  const json = args.json === true;
  const loc = locate(null);
  if (loc.error) return failLoc(loc);
  const board = loc.board;
  const me = actorOf(process.env, board);
  const wanted = typeof args.executor === "string" && args.executor.trim() ? args.executor.trim() : me;
  // 板默认执行体（如 `local` = 本机会话/人的手）：派给它的任务，任何本机会话都能领
  const boardDefault = String(board.executors?.[0]?.id ?? "").trim();
  const lanes = readLanes(board.root);
  const laneOwnerOf = (subver) => {
    const v = versionOfSubver(subver);
    const hit = lanes.ok ? lanes.list.find((l) => l.version === v) : null;
    return hit?.owner ?? null;
  };

  // 扫全板：我的续作 + 可领的 ready（索引只读一次；子版号与车道归属按需求查表）
  const mine = [];
  const open = [];
  const reqEntries = readReqEntries(board.root);
  const reqById = new Map(reqEntries.map((r) => [String(r.id), r]));
  const waiting = []; // 被依赖卡住的 ready 任务（不是「没活」，是「活都在等」）
  const reqIds = readdirSync(join(board.root, "reqs"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && isReqDir(d.name))
    .map((d) => d.name);
  for (const reqId of reqIds) {
    const ledger = readTaskLedger(board.root, reqId);
    const subver = String(reqById.get(reqId)?.subver ?? "").trim();
    const owner = laneOwnerOf(subver);
    for (const t of ledger.tasks) {
      const claim = claimOf(t);
      if (claim && claim.session === sessionIdFromEnv() && !isClaimExpired(claim)) {
        mine.push({ req: reqId, task: t, subver, lane: owner });
        continue;
      }
      if (t.status !== "ready") continue;
      // 他人版本线的活不领（领了也会被车道闸门拒——别把不可领的活摆给人看）
      if (owner !== null && owner !== wanted) continue;
      const assigned = String(t.executor ?? "").trim();
      const mineToTake = !assigned || assigned === wanted || assigned === boardDefault;
      if (!mineToTake) continue; // 明确派给别人的不抢
      // 依赖闸门（0.47）：被卡住的活**不进池**，但要记下来——「池空」和「都在等」是两件事。
      //   只挡 ready 的候选；自己手上已开工的续作（mine）不再回退，依赖是开工闸门不是持续不变量。
      const gate = depGateOf({ reqId, task: t, ledgerTasks: ledger.tasks, reqEntries });
      if (!gate.ok) {
        waiting.push({ req: reqId, task: t, blocked: gate.blocked });
        continue;
      }
      open.push({ req: reqId, task: t, subver, lane: owner, assigned });
    }
  }
  const pick = mine[0] ?? rankOpen(open, wanted)[0] ?? null;

  if (!pick) {
    // 「没有活」和「活都在等」是两件事：后者若说成「池空」，人会以为板是空的、去别处找活
    if (waiting.length > 0) {
      if (json) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              board: board.id,
              me: wanted,
              task: null,
              reason: `没有可开工的任务：${waiting.length} 条 ready 任务都在等前置`,
              waiting: waiting.map((w) => ({ task: w.task.id, req: w.req, waiting_on: w.blocked.map((b) => b.id) })),
            },
            null,
            2
          )
        );
        return 0;
      }
      console.log(out.warn(`板 ${board.id}（身份 ${wanted}）：没有可开工的任务——${waiting.length} 条 ready 任务都在等前置。`));
      for (const w of waiting.slice(0, 8)) {
        console.log(out.dim(`  · ${w.task.id}（${w.req}）等 ${w.blocked.map((b) => `${b.id}[${b.status || "未知"}]`).join(" / ")}`));
      }
      if (waiting.length > 8) console.log(out.dim(`  · …另有 ${waiting.length - 8} 条`));
      console.log(out.dim("  · 看依赖图：gd req dep list <需求id> · 确实要先动：gd work start <任务id> --ignore-deps"));
      return 0;
    }
    if (json) {
      console.log(JSON.stringify({ ok: true, board: board.id, me: wanted, task: null, reason: "池空：没有可领的任务（ready 且属于我的线或未认领的线）" }, null, 2));
      return 0;
    }
    console.log(out.dim(`板 ${board.id}（身份 ${wanted}）：池空——没有可领的任务。`));
    console.log(out.dim("  · 看看全局：gd task list --todo   · 看自己的线：gd ver lanes"));
    return 0;
  }

  const picked = { taskId: pick.task.id, title: pick.task.title, req: pick.req, executor: pick.task.executor ?? "", resume: mine[0] === pick, lane: pick.lane };
  if (args.claim !== true) {
    if (json) {
      console.log(JSON.stringify({ ok: true, board: board.id, me: wanted, ...picked }, null, 2));
      return 0;
    }
    console.log(out.ok(`下一条：${picked.taskId}  ${picked.title}`));
    console.log(`  需求 ${picked.req}${picked.lane ? ` · 版本线 ${picked.lane}` : ""}${picked.resume ? " · 你手上的续作" : ""}`);
    console.log(out.dim(`  · 领它：gd work claim ${picked.taskId}   · 直接开工：gd work next --claim → gd work start ${picked.taskId}`));
    return 0;
  }

  const ttl = args.ttl === undefined ? DEFAULT_LEASE_MINUTES : Number(args.ttl);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    console.error(errOut.err("✗ --ttl 需正数（分钟）"));
    return 1;
  }
  // 负责人（executor）必须是**板内名册**里的名字；会话身份（GD_EXECUTOR，如 w2）只进 claim.session。
  //   所以认领时沿用任务原有负责人（或板默认），不把会话名塞进 executor——否则名册闸门会拒。
  const claimExecutor = String(pick.task.executor ?? "").trim() || boardDefault || DEFAULT_EXECUTOR;
  const r = claimCore({ board, hit: { reqId: pick.req, task: pick.task }, taskId: pick.task.id, executor: claimExecutor, ttl, session: sessionIdFromEnv(), argsForce: args.force === true });
  if (!r.ok) {
    console.error(errOut.err(`✗ ${r.error}`));
    for (const h of r.hint ?? []) console.error(`  · ${h}`);
    return 1;
  }
  if (json) {
    console.log(JSON.stringify({ ok: true, board: board.id, claimed: true, ...picked, status: r.task.status, claim: r.task.claim }, null, 2));
    return 0;
  }
  console.log(out.ok(`✅ 已领：${picked.taskId}  ${picked.title}`));
  console.log(`  负责人 ${r.task.executor} · ${r.fromStatus} → ${r.task.status} · 租约 ${ttl} 分钟`);
  console.log(out.dim(`  · 开工作区：gd work start ${picked.taskId}`));
  return 0;
}

/** ready 任务的排序：我的线 > 未认领线 > 他人线（他人线靠后，claim 时闸门会拒） */
function rankOpen(list, me) {
  const rankOf = (x) => (x.lane === me ? 0 : x.lane === null ? 1 : 2);
  return [...list].sort((a, b) => rankOf(a) - rankOf(b) || String(a.task.id).localeCompare(String(b.task.id)));
}

/**
 * `gd work migrate` —— 旧 `work` 块 → **工作单元**（0.41 · 设计稿附录 A.3）。
 *
 * 缺省**只看计划**（dry-run）：迁移要动账，先让人看清动哪些。写盘用 `--apply`。
 * 两类旧数据分开处理（未收尾 → 迁；已 done → 默认不动）的判据在 `lib/work-migrate.mjs`。
 */
function doMigrate(args) {
  const json = args.json === true;
  const apply = args.apply === true;
  const pruneDone = args["prune-done"] === true;
  const rb = resolveBoard({ cwd: process.cwd() });
  if (!rb.board || rb.board.error) {
    console.error(errOut.err("✗ 未定位到板（" + (rb.board?.error ?? "三处皆无") + "）——先 gd core init"));
    return 1;
  }
  const board = rb.board;
  const repo = codeRepoOf(board) ?? "";
  const { plan, legacyDone, scanned } = planWorkUnitMigration({ boardRoot: board.root, repo });

  if (!apply || json) {
    if (json && !apply) {
      console.log(JSON.stringify({ ok: true, applied: false, plan, legacyDone, scanned }, null, 2));
      return 0;
    }
    if (!json) printMigratePlan({ plan, legacyDone, scanned, apply });
  }
  if (!apply) return 0;

  const res = applyWorkUnitMigration({
    boardRoot: board.root,
    plan,
    legacyDone,
    pruneDone,
    repo,
    session: sessionIdFromEnv(),
    mutate: mutateTaskLedger,
  });
  if (json) {
    console.log(JSON.stringify({ ok: true, applied: true, ...res, plan }, null, 2));
    return 0;
  }
  console.log(out.ok("✅ 已迁移 " + res.units + " 个工作单元（" + res.reqs + " 个需求）"));
  if (pruneDone) console.log(out.dim("  · 已 done 的死 work 块已清 " + res.pruned + " 处（历史仍在 git 提交里）"));
  console.log(out.dim("  · 建议留一版账快照：gd core snap -m \"work migrate\""));
  return 0;
}

/** 迁移计划的人话版（缺省 / 未 --apply 时打印） */
function printMigratePlan({ plan = [], legacyDone = [], scanned = {}, apply = false } = {}) {
  if (!plan.length && !legacyDone.length) {
    console.log(out.ok("✅ 没有需要迁移的旧 work 块"));
    return;
  }
  if (plan.length) {
    const reqCount = new Set(plan.map((p) => p.reqId)).size;
    console.log(out.dim((apply ? "迁移" : "计划迁移") + "：" + plan.length + " 个工作单元（" + reqCount + " 个需求）"));
    for (const p of plan) {
      const reuse = p.reusePath ? " · 沿用旧工作树 " + p.path : "";
      console.log("  · " + p.reqId + " → " + p.unitId + "（" + (p.executor || "未记执行体") + "）· 任务 " + p.tasks.join(" / ") + reuse);
    }
  }
  if (legacyDone.length) {
    const n = legacyDone.reduce((a, b) => a + b.count, 0);
    console.log(out.dim("  · 已 done 的旧 work 块 " + n + " 处（" + legacyDone.length + " 个需求）默认不动；要清加 --prune-done"));
  }
  if (!apply) console.log(out.dim("  · 这是**计划**：确认后加 --apply 才写账（建议先 gd core snap）"));
}

/**
 * 把一个工作单元从账上摘掉（`work_units[]` 条目 + 任务上的 `work_unit` 引用）。
 *
 * 只给 `work sweep --apply` 在**回收成功之后**用：单元还活着时摘它等于把「谁在做这件事」从账上抹掉。
 * 为什么必须摘（B-gm-000049）：不摘的话账上永远留着「盘上已经没有」的单元 ⇒ 下一轮 sweep 又把它
 *   扫出来（absent / 可回收），**连跑两轮报同一批** —— 清扫永远不收敛。
 */
function dropWorkUnit(board, reqId, unitId) {
  let unlinked = 0;
  const after = mutateTaskLedger(board.root, reqId, (l) => {
    const units = (Array.isArray(l.workUnits) ? l.workUnits : []).filter((u) => String(u.id) !== String(unitId));
    // 任务上的引用一并清：单元已经不在了，留着引用会让后续 `work start` 撞上「引用的工作单元不在账里」
    const tasks = l.tasks.map((t) => {
      if (String(t.work_unit ?? "") !== String(unitId)) return t;
      unlinked += 1;
      const next = { ...t };
      delete next.work_unit;
      return next;
    });
    return { ...l, tasks, workUnits: units };
  });
  return { dropped: !(after.workUnits ?? []).some((u) => String(u.id) === String(unitId)), unlinked };
}

/**
 * `gd work sweep` —— 清扫 kept 工作区（0.45 · T-gm-45-0-02）
 *
 * 为什么要它：`land` 会因为「人在里面 / 有外部联接 / 回收失败」把工作区**保留**（kept），
 *   保留之后没人再管 —— 谁的任务、为什么没回收、什么时候该清，只散在几十个任务账的
 *   `landed.cleanup` 里，查不动。于是工作区越攒越多，且每个都可能藏着一个致命联接。
 *
 * 三条口径（判定逻辑在 `lib/work-sweep.mjs`，本函数只管 git 操作）：
 *   ① 回收前先摘**指向外部的联接**（`lib/work-links.mjs`）；摘不掉 ⇒ **保留并留原因**，不硬删
 *      （git 的递归删除会穿透 junction，把目标内容清空 —— B-gm-000010 实测 91 个包）。
 *   ② kept 留清单与原因：哪条任务 / 为什么没回收 / 什么时候再清 —— 落 `<板根>/work-sweep.jsonl` 可复查。
 *   ③ **不碰主工作区**（仓根本身与它下面的 `node_modules` 这种真实目录）。
 *
 * 缺省**只看不动**（打印清单 + 判定 + 下次复查时间）；`--apply` 才回收。
 * `--apply` 回收成功后**同时摘掉账上的 `work_units[]` 条目**（B-gm-000049）——只删盘不删账，
 *   下一轮还会把同一个单元扫出来，清扫就永远不收敛。
 */
function doSweep(args) {
  const json = args.json === true;
  const apply = args.apply === true;
  const rb = resolveBoard({ cwd: process.cwd() });
  if (!rb.board || rb.board.error) {
    console.error(errOut.err(`✗ 未定位到板（${rb.board?.error ?? "三处皆无"}）——先 gd core init`));
    return 1;
  }
  const board = rb.board;

  // `--history`：只读复查（这是个「看」的入口，不是清扫）
  if (args.history === true) {
    const rows = readSweepLog(board.root);
    if (json) {
      console.log(JSON.stringify({ ok: true, board: board.id, log: SWEEP_LOG_REL, rows }, null, 2));
      return 0;
    }
    console.log(`\n清扫留痕（${board.root.split("\\").join("/")}/${SWEEP_LOG_REL} · ${rows.length} 条）`);
    if (!rows.length) console.log(out.dim("  · 还没有清扫记录（gd work sweep --apply 才会留痕）"));
    for (const r of rows) {
      const when = String(r.at ?? "").slice(0, 19).replace("T", " ");
      const act = r.action === "removed" ? "已回收" : r.action === "kept" ? "保留" : String(r.action ?? "");
      console.log(`  ${when}  ${act}  ${r.unit ?? r.path ?? ""}  ${r.reason ?? ""}`);
    }
    console.log("");
    return 0;
  }

  const repo = codeRepoOf(board);
  if (!repo) {
    console.error(errOut.err(`✗ 板配置的 repo 不是 git 仓库：${board.repo ?? "（空）"}`));
    return 1;
  }
  const rawDays = Number(args.days);
  const staleDays = Number.isFinite(rawDays) && rawDays >= 0 ? rawDays : DEFAULT_STALE_DAYS; // --days 0 = 不设阈值（活都归档就回收）

  // ① 账上的工作单元（逐需求扫；与 `gd work list` 同一套扫描口径）
  const units = [];
  const openByUnit = new Map();
  const reqsDir = join(board.root, "reqs");
  const reqIds = existsSync(reqsDir) ? readdirSync(reqsDir).filter((d) => isReqDir(d)) : [];
  for (const reqId of reqIds) {
    const ledger = readTaskLedger(board.root, reqId);
    for (const u of ledger.workUnits ?? []) {
      units.push({ unitId: String(u.id), branch: String(u.branch ?? ""), path: String(u.path ?? ""), reqId });
      const open = ledger.tasks.filter((t) => String(t.work_unit ?? "") === String(u.id) && !t.landed).map((t) => t.id);
      openByUnit.set(String(u.id), open);
    }
  }

  // ② 盘上的 worktree（补「账上没有」的孤儿：手动开的工作区、别的会话留下的）
  const wt = runGit(repo, ["worktree", "list", "--porcelain"]);
  const onDisk = [];
  let cur = null;
  for (const line of String(wt.stdout ?? "").split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice("worktree ".length).trim(), branch: "" };
      onDisk.push(cur);
    } else if (cur && line.startsWith("branch ")) {
      cur.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    }
  }
  const norm = (p) => String(p ?? "").split("\\").join("/").replace(/\/+$/, "").toLowerCase();
  const known = new Set(units.map((u) => norm(u.path)).filter(Boolean));
  for (const w of onDisk) {
    if (norm(w.path) === norm(repo)) continue; // 主工作区
    if (known.has(norm(w.path))) continue;
    units.push({ unitId: "", branch: w.branch, path: w.path, reqId: "", orphan: true });
  }

  /** 分支最近一次活动（天）；拿不到就退回目录 mtime，再拿不到给 null（按「无证据」处理） */
  const idleDaysOf = (u) => {
    if (u.branch) {
      const t = runGit(repo, ["log", "-1", "--format=%ct", u.branch]);
      const sec = Number(String(t.stdout ?? "").trim());
      if (t.ok && Number.isFinite(sec) && sec > 0) return Math.floor((Date.now() - sec * 1000) / 86_400_000);
    }
    try {
      return Math.floor((Date.now() - statSync(u.path).mtimeMs) / 86_400_000);
    } catch {
      return null;
    }
  };

  const decided = [];
  for (const u of units) {
    const exists = !!u.path && existsSync(u.path);
    if (u.orphan) {
      decided.push({
        unit: u.unitId,
        reqId: "",
        branch: u.branch,
        path: u.path,
        kind: "orphan",
        removable: false,
        reason: "盘上有这个工作区、账上没有它 —— 先确认是不是手动开的（清扫不替人做主）",
        nextCheckDays: staleDays,
        needsUnlink: exists ? findExternalLinks(u.path).length > 0 : false,
      });
      continue;
    }
    const links = exists ? findExternalLinks(u.path).map((l) => l.path) : [];
    const d = classifyUnit({
      unitId: u.unitId,
      branch: u.branch,
      path: u.path,
      repoRoot: repo,
      exists,
      inCwd: exists ? cwdWithin(u.path) : false,
      links,
      openTasks: openByUnit.get(u.unitId) ?? [],
      idleDays: exists ? idleDaysOf(u) : null,
      staleDays,
    });
    decided.push({ unit: u.unitId, reqId: u.reqId, branch: u.branch, path: u.path, links, ...d });
  }

  // ③ 执行（`--apply` 才动磁盘）；每条都留痕
  const logRows = [];
  const at = new Date().toISOString();
  const results = [];
  for (const d of decided) {
    let final = { ...d };
    if (apply && d.removable) {
      // 先摘联接：摘不掉就**保留**并留原因（绝不硬删）
      let unsafe = null;
      for (const l of d.links ?? []) {
        if (!unlinkLink(l)) unsafe = l;
      }
      if (unsafe) {
        final = { ...d, kind: "unsafe-link", removable: false, reason: `摘不掉指向外部的联接：${unsafe}（保留，不硬删）`, nextCheckDays: staleDays };
      } else if (!existsSync(final.path)) {
        // 目录已不在：只剩分支与登记（分支**本来就不存在**是常态，不是失败）
        const del = final.branch ? runGit(repo, ["branch", "-D", final.branch]) : { ok: true };
        final = { ...final, action: "removed", cleanup: branchCleanup(del) };
      } else {
        const rm = runGit(repo, ["worktree", "remove", "--force", final.path]);
        const delMark = final.branch ? branchCleanup(rm.ok ? runGit(repo, ["branch", "-D", final.branch]) : null) : "branch-deleted";
        final = {
          ...final,
          action: rm.ok ? "removed" : "kept",
          removable: rm.ok,
          reason: rm.ok ? `${final.reason}（已回收）` : `回收失败：${failReason(rm)}`,
          cleanup: rm.ok ? (delMark === "branch-deleted" ? "worktree+branch" : `worktree removed · ${delMark}`) : failReason(rm),
          nextCheckDays: rm.ok ? null : staleDays,
        };
      }
    } else {
      final.action = final.removable ? "would-remove" : "kept";
    }
    // B-gm-000049：**回收成功 ⇒ 账也要摘**。只删盘不删账，下一轮 sweep 还会把同一个单元扫出来
    //   （它的 branch/path 还在 `work_units[]` 里）⇒ 连跑两轮报同一批，清扫永远不收敛。
    //   只对「账上有它」的单元做（孤儿单元账上本来就没有，无从摘）；摘失败不回滚盘上动作，但要留原因。
    if (apply && final.action === "removed" && final.reqId && final.unit) {
      try {
        const drop = dropWorkUnit(board, final.reqId, final.unit);
        final = { ...final, account: drop.dropped ? "unit-dropped" : "unit-absent", unlinkedTasks: drop.unlinked };
      } catch (e) {
        final = { ...final, account: "drop-failed", accountError: String(e?.message ?? e) };
      }
    }
    results.push(final);
    if (apply) {
      logRows.push({
        at,
        unit: final.unit,
        branch: final.branch,
        path: final.path,
        action: final.action,
        kind: final.kind,
        reason: final.reason,
        ...(final.account ? { account: final.account } : {}),
      });
    }
  }
  if (apply) appendSweepLog(board.root, logRows);

  const sum = summarize(results);
  if (json) {
    console.log(JSON.stringify({ ok: true, board: board.id, applied: apply, staleDays, summary: sum, items: results }, null, 2));
    return 0;
  }
  console.log(`\n工作区清扫 · 板 ${board.id} · 阈值 ${staleDays} 天 · ${apply ? "已执行" : "只看不动（加 --apply 才回收）"}`);
  if (!results.length) console.log(out.dim("  · 盘上没有工作区（除了主工作区）"));
  for (const r of results) {
    const mark = r.action === "removed" ? out.ok("已回收") : r.action === "would-remove" ? out.warn("待回收") : out.dim("保留  ");
    console.log(`  ${mark} ${r.unit || "（账上没有）"}${r.branch ? "  " + r.branch : ""}`);
    console.log(out.dim(`         ${String(r.path ?? "").split("\\").join("/")}`));
    console.log(`         ${r.reason}${nextCheckText(r.nextCheckDays) ? out.dim(" · " + nextCheckText(r.nextCheckDays)) : ""}`);
    if (r.cleanup && r.action === "removed") console.log(out.dim(`         ${cleanupText(r.cleanup)}`));
    if (r.account === "unit-dropped") {
      console.log(out.dim(`         账上工作单元已摘掉${r.unlinkedTasks ? `（${r.unlinkedTasks} 条任务上的引用一并清）` : ""} —— 下一轮不会再扫到它`));
    } else if (r.account === "drop-failed") {
      console.log(out.warn(`         盘上已回收，但账没摘掉：${r.accountError}（下一轮还会扫到它，先修这个）`));
    }
  }
  console.log(
    `\n  合计 ${sum.total} 个工作区：可回收 ${sum.removable} · 保留 ${sum.kept}${sum.unsafeLink ? `（其中联接摘不掉 ${sum.unsafeLink}）` : ""}`
  );
  if (apply && logRows.length) console.log(out.dim(`  · 已留痕：${board.root.split("\\").join("/")}/${SWEEP_LOG_REL}（gd work sweep --history 复查）`));
  if (!apply && sum.removable) console.log(out.dim("  · 确认无误后：gd work sweep --apply"));
  return 0;
}

/**
 * `gd work deps` —— **共享依赖**（0.45 · T-gm-45-0-03）。
 *
 * 唯一安全形态：把依赖装到**所有工作区的公共父目录**（`<repo>.wt/node_modules`），让 Node 的向上解析命中它。
 *   **绝不**把工作区的 `node_modules` 做成指向主仓的联接 —— 回收工作区时 git 的递归删除会穿透
 *   junction，把主仓依赖清空（B-gm-000010 实测：91 个包没了、目录还在）。
 *
 * 缺省只看（报告缺哪些包、装到哪）；`--apply` 才真装（复制 package.json + lock 到公共父目录，在那里 npm ci）。
 */
function doDeps(args) {
  const json = args.json === true;
  const apply = args.apply === true;
  const rb = resolveBoard({ cwd: process.cwd() });
  if (!rb.board || rb.board.error) {
    console.error(errOut.err(`✗ 未定位到板（${rb.board?.error ?? "三处皆无"}）——先 gd core init`));
    return 1;
  }
  const repo = codeRepoOf(rb.board);
  if (!repo) {
    console.error(errOut.err(`✗ 板配置的 repo 不是 git 仓库：${rb.board.repo ?? "（空）"}`));
    return 1;
  }
  // 公共父目录 = 工作区根（缺省 <repo>.wt，所有工作区的上一级）—— 直接按仓算，不必先有工作区。
  const customRoot = typeof args["worktree-dir"] === "string" && args["worktree-dir"].trim() ? args["worktree-dir"].trim() : null;
  const sharedRoot = customRoot || sharedRootForRepo(repo);
  const st = sharedDepsStatus({ repo, sharedRoot });
  if (json && !apply) {
    console.log(JSON.stringify({ ok: st.ok, target: st.target, depsDir: join(st.target, "node_modules"), present: st.present, missing: st.missing, mismatched: st.mismatched, needSync: st.needSync, hint: st.hint }, null, 2));
    return 0;
  }
  if (!apply) {
    console.log(out.dim(`共享依赖落点：${join(st.target, "node_modules")}（所有工作区向上解析会命中它）`));
    if (st.ok) console.log(out.ok(`✅ 已就绪（${st.present} 个包）`));
    else {
      console.log(out.warn(`⚠ 未就绪：缺 ${st.missing.length} 个、版本不符 ${st.mismatched.length} 个`));
      for (const m of st.missing.slice(0, 6)) console.log(out.dim(`      · 缺 ${m}`));
      for (const m of st.mismatched.slice(0, 6)) console.log(out.dim(`      · ${m.name}：声明 ${m.declared} 装的是 ${m.installed}`));
      console.log(out.dim("  · 真装：gd work deps --apply（复制 package.json + lock 到公共父目录后 npm ci；不建联接）"));
    }
    return 0;
  }
  const runner = (cmd, _a, opts) => {
    const r = spawnSync(cmd, [], { cwd: opts?.cwd, shell: true, encoding: "utf8", timeout: 15 * 60 * 1000 });
    return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr || r.error?.message || "" };
  };
  const sync = syncSharedDeps({ repo, sharedRoot, apply: true, run: runner });
  if (json) {
    console.log(JSON.stringify(sync, null, 2));
    return sync.ok ? 0 : 1;
  }
  if (sync.ok) {
    console.log(out.ok(`✅ ${sync.hint}`));
    return 0;
  }
  console.error(errOut.err(`✗ 共享依赖同步失败：${sync.error ?? sync.hint}`));
  return 1;
}

/** 入口（gd.mjs `work` 家族转发） */
export function runWork(sub, rest) {
  const subName = String(sub ?? "");
  if (!WORK_SUBCOMMANDS.includes(subName)) {
    console.error(errOut.err(`✗ 未知子命令 "work ${subName}"。可用：${WORK_SUBCOMMANDS.join(" / ")}\n${USAGE}`));
    return 1;
  }
  const args = parseArgs(rest);
  const allowed = SUB_FLAGS[subName];
  const unknown = Object.keys(args).filter((k) => k !== "_" && !allowed.includes(`--${k}`));
  if (unknown.length) {
    console.error(errOut.err(`✗ 未知参数：${unknown.map((k) => `--${k}`).join(" ")}（work ${subName} 接受：${allowed.join(" ")}）\n${USAGE}`));
    return 1;
  }
  if (subName === "claim") return doClaim(args);
  if (subName === "next") return doNext(args);
  if (subName === "release") return doRelease(args);
  if (subName === "start") return doStart(args);
  if (subName === "submit") return doSubmit(args);
  if (subName === "land") return doLand(args);
  if (subName === "migrate") return doMigrate(args);
  if (subName === "deps") return doDeps(args);
  if (subName === "sweep") return doSweep(args);
  return doList(args);
}

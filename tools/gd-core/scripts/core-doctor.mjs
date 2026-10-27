/**
 * `gd core doctor` —— **并行安全体检**（一条命令代替照文档手敲，0.21.11）
 *
 * 定位：多会话并行开发时，人只需要记住一条命令就能看清"账还健康吗"。**只读**——
 *   不写账、不改文件、不跑重型 e2e（真要跑门禁，本命令末尾会点名该跑哪几条）。
 *
 * 六项体检（每项 ✅ / ⚠ / ✗）：
 *   ① 板与账：板可解析 / 板库（账快照）是否启用 / 快照数
 *   ①b 异地备份：板账有无可推远端、本机有没有真备过（盘坏即账灭——这条不绿就得当心）
 *   ② 账自洽：需求条数、任务总数、事件流可解析且序号不乱
 *   ③ 占用卫生：未收尾任务里过期占用几条、已收尾（done/review）却仍带 claim 几条
 *   ④ 版本线：每条线归属与需求数；有归属的线上是否有**他人 executor 的任务**（跨线污染）
 *   ⑤ 结版积压：需求已全验收但**未结版**的子版（待结版清单——结版要用户点名）
 *   ⑥ 门禁提示：该跑哪几条命令（不自动跑）
 *
 * `--fix`：顺手清掉「已收尾（done/review）却仍带 claim」的历史占用（**唯一写动作**，低危、幂等）。
 * 退出码：无 ✗ ⇒ 0；有 ✗ ⇒ 1（⚠ 不影响）。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { out } from "./lib/style.mjs";
import { resolveBoard } from "./lib/board-resolve.mjs";
import { readAllLedgers, readReqEntries, readTaskLedger, withBoardLock, writeTaskLedger } from "./lib/board.mjs";
import { isClaimExpired, claimOf } from "./lib/workclaim.mjs";
import { boardOrigin, deliveryOrigin, log as boardLog, readBackupMark, snapshotEnabled } from "./lib/board-vcs.mjs";
import { readLanes } from "./lib/lanes.mjs";
import { closedOf, readSubvers } from "./lib/subvers.mjs";
import { parseYaml } from "./lib/yaml.mjs";

export const CLI_FLAGS = ["--json", "--fix"];

/** 框架本仓根（本文件在 `scripts/` 下 ⇒ 上两级） */
const FRAMEWORK_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** 板仓是否就是**框架本仓**——只有这种「自举板」才谈得上跑框架门禁 */
function isFrameworkBoard(board) {
  const repo = String(board?.repo ?? "").trim();
  return repo !== "" && resolve(repo).toLowerCase() === FRAMEWORK_ROOT.toLowerCase();
}

/** 体检：返回 [{id, title, level: "ok"|"warn"|"fail", detail, rows?}] */
export function doctorChecks(board, { now = Date.now() } = {}) {
  const checks = [];
  const push = (id, title, level, detail, rows = null) => checks.push({ id, title, level, detail, ...(rows ? { rows } : {}) });

  // ① 板与账库
  const vcsOn = snapshotEnabled(board.root);
  const snap = boardLog(board.root, 1);
  if (!vcsOn) push("board-vcs", "账库（账快照）", "warn", "未启用——账被改坏时无法 diff / 回滚（gd core snap --init）");
  else push("board-vcs", "账库（账快照）", "ok", `已启用 · 最近快照 ${snap.entries?.[0] ? `${snap.entries[0].hash}（${snap.entries[0].at}）` : "—"}`);

  // ①b 异地备份：板账只在本机 ⇒ 盘坏即账灭；有远端 + 真备过，才算有第二条命
  const ownRemote = boardOrigin(board.root);
  const repoRemote = ownRemote ? null : deliveryOrigin(board.repo);
  const mark = readBackupMark(board.root);
  if (!ownRemote && !repoRemote) {
    push("board-backup", "异地备份（板账远端）", "warn", "无可用远端——盘坏即账灭（gd core snap --backup --remote <url>）");
  } else if (!mark) {
    push("board-backup", "异地备份（板账远端）", "warn", `远端可推导（${ownRemote ? "板账仓 origin" : "交付仓 origin"}）但本机从未备份过（gd core snap --backup）`);
  } else {
    push("board-backup", "异地备份（板账远端）", "ok", `已备份 · ${String(mark.at ?? "").slice(0, 16).replace("T", " ")} · ${mark.ref}@${String(mark.hash ?? "").slice(0, 7)}`);
  }

  // ② 账自洽
  const reqs = readReqEntries(board.root);
  const ledgers = readAllLedgers(board.root);
  const tasks = [...ledgers.values()].flatMap((l) => l.tasks);
  const badEvents = [];
  const seqIssues = [];
  for (const reqId of ledgers.keys()) {
    const p = join(board.root, "reqs", reqId, "events.jsonl");
    if (!existsSync(p)) continue;
    const lines = readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean);
    let last = 0;
    for (const [i, line] of lines.entries()) {
      let e = null;
      try {
        e = JSON.parse(line);
      } catch {
        badEvents.push(`${reqId}:${i + 1}`);
        continue;
      }
      if (Number(e.seq) <= last) seqIssues.push(`${reqId}:${i + 1}`);
      last = Math.max(last, Number(e.seq) || 0);
    }
  }
  const ledgerOk = badEvents.length === 0 && seqIssues.length === 0;
  push(
    "ledger",
    "账自洽（需求 / 任务 / 事件流）",
    ledgerOk ? "ok" : "fail",
    `需求 ${reqs.length} 条 · 任务 ${tasks.length} 个 · 事件流${ledgerOk ? "可解析且序号单调" : `异常（坏行 ${badEvents.length} / 乱序 ${seqIssues.length}）`}`,
    ledgerOk ? null : [...badEvents, ...seqIssues].slice(0, 5)
  );

  // ③ 占用卫生
  const open = tasks.filter((t) => t.status !== "done" && t.status !== "review");
  const stale = open.filter((t) => {
    const c = claimOf(t);
    return c && isClaimExpired(c, { now });
  });
  const leftover = tasks.filter((t) => (t.status === "done" || t.status === "review") && claimOf(t));
  const hygieneLevel = leftover.length > 0 ? "fail" : stale.length > 0 ? "warn" : "ok";
  push(
    "claims",
    "占用卫生",
    hygieneLevel,
    `未收尾任务 ${open.length} 个 · 过期占用 ${stale.length} 条${leftover.length ? ` · **已收尾却仍带 claim ${leftover.length} 条**（应收尾即放）` : ""}`,
    leftover.slice(0, 5).map((t) => `${t.id} ${t.status}`)
  );

  // ④ 版本线
  const lanes = readLanes(board.root);
  const laneRows = [];
  let crossLine = 0;
  for (const lane of lanes.ok ? lanes.list : []) {
    const mine = reqs.filter((r) => String(r.subver ?? "").startsWith(`${lane.version}.`));
    const myReqIds = new Set(mine.map((r) => String(r.id)));
    const foreign = tasks.filter((t) => {
      const l = [...ledgers.entries()].find(([, v]) => v.tasks.includes(t));
      if (!l || !myReqIds.has(String(l[0]))) return false;
      return String(t.executor ?? "").trim() && String(t.executor).trim() !== lane.owner;
    });
    crossLine += foreign.length;
    laneRows.push(`${lane.version} 归 ${lane.owner} · 需求 ${mine.length} 条${foreign.length ? ` · 他人任务 ${foreign.length}` : ""}`);
  }
  push(
    "lanes",
    "版本线归属",
    crossLine > 0 ? "warn" : "ok",
    lanes.ok ? `已认领 ${laneRows.length} 条线${crossLine ? ` · 跨线任务 ${crossLine} 条（executor 与线主不同，需确认是否 --force 越过）` : ""}` : `读取失败：${lanes.error}`,
    laneRows
  );

  // ⑤ 结版积压
  const sv = readSubvers(board.root);
  const closed = closedOf(sv.ok ? sv.list : []);
  const bySubver = new Map();
  for (const r of reqs) {
    const v = String(r.subver ?? "").trim();
    if (!v) continue;
    if (!bySubver.has(v)) bySubver.set(v, []);
    bySubver.get(v).push(r);
  }
  const backlog = [...bySubver.entries()]
    .filter(([alias, list]) => list.every((r) => String(r.status) === "done") && !closed(alias))
    .map(([alias]) => alias)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  push("close", "结版积压（已完成 · 待结版）", backlog.length ? "warn" : "ok", backlog.length ? `${backlog.length} 条待你点名结版` : "无积压", backlog.length ? backlog : null);

  return checks;
}

/** 渲染（人读） */
function renderReport(board, checks) {
  const icon = { ok: out.ok("✅"), warn: out.warn("⚠"), fail: out.err("✗") };
  console.log(`板 ${board.id}（${board.name ?? "-"}）· 模式 ${board.mode} · 体检 ${checks.length} 项`);
  console.log("");
  for (const c of checks) {
    console.log(`${icon[c.level]} ${c.title}：${c.detail}`);
    for (const r of c.rows ?? []) console.log(out.dim(`     · ${r}`));
  }
  console.log("");
  const fail = checks.filter((c) => c.level === "fail").length;
  const warn = checks.filter((c) => c.level === "warn").length;
  console.log(fail ? out.err(`✗ ${fail} 项需处理${warn ? ` · ${warn} 项提醒` : ""}`) : warn ? out.warn(`⚠ ${warn} 项提醒（不影响并行）`) : out.ok("✅ 全项通过"));
  if (warn && checks.find((c) => c.id === "close")?.rows) {
    console.log(out.dim("  · 结版要你点名：gd ver reach <x.y.z> --confirm <x.y.z>"));
  }
  // 门禁提示只对「框架本仓自举成板」有意义：contract check / ui-check 与 cwd 无关，查的始终是框架本体，
  //   项目仓里照抄这句只会让人去跑一个跟本仓无关的命令
  if (isFrameworkBoard(board)) {
    console.log(out.dim("  · 共享内核回归（常规必要）：gd contract check --scope all ／ node scripts/ui-check.mjs --changed"));
  }
}

/** `--fix`：清掉已收尾任务上残留的 claim（历史遗留；0.21.6 之前写入的账） */
export function fixLeftoverClaims(board) {
  const ledgers = readAllLedgers(board.root);
  let cleared = 0;
  for (const [reqId, ledger] of ledgers) {
    const stale = ledger.tasks.filter((t) => (t.status === "done" || t.status === "review") && claimOf(t));
    if (stale.length === 0) continue;
    withBoardLock(board.root, () => {
      const fresh = readTaskLedger(board.root, reqId);
      const tasks = fresh.tasks.map((t) => {
        if (t.status !== "done" && t.status !== "review") return t;
        if (!claimOf(t)) return t;
        const next = { ...t };
        delete next.claim;
        return next;
      });
      writeTaskLedger(board.root, reqId, { req: fresh.req, tasks }, { expectedRev: fresh.revision });
    }, { label: "doctor --fix" });
    cleared += stale.length;
  }
  return cleared;
}

export function runDoctor(args = {}) {
  const json = args.json === true;
  const rb = resolveBoard({ cwd: process.cwd() });
  if (!rb.board || rb.board.error) {
    if (json) console.log(JSON.stringify({ ok: false, error: rb.board?.error ?? "未定位到板", searched: rb.searched }, null, 2));
    else console.error(out.err(`✗ 未定位到板（${rb.board?.error ?? "三处皆无"}）——先 gd core init`));
    return 1;
  }
  let fixed = 0;
  if (args.fix === true) fixed = fixLeftoverClaims(rb.board); // 唯一写动作：清已收尾的残留占用
  const checks = doctorChecks(rb.board);
  const fail = checks.filter((c) => c.level === "fail").length;
  const warn = checks.filter((c) => c.level === "warn").length;
  if (json) {
    console.log(JSON.stringify({ ok: fail === 0, board: rb.board.id, fixed, fail, warn, checks }, null, 2));
  } else {
    if (args.fix === true && fixed > 0) console.log(out.ok(`✅ 已清理 ${fixed} 条已收尾任务的残留占用`));
    renderReport(rb.board, checks);
  }
  return fail === 0 ? 0 : 1;
}

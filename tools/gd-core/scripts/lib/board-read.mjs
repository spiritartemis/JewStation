/**
 * `scripts/lib/board-read.mjs` — **读面单一实现**（core 层）。
 *
 * 板 / 任务 / 需求 / 里程碑的看与查，取数与渲染都收在这里，`gd` 与 `gd-core` 共用同一份
 * （两份实现必然漂移，读面漂移最伤：数字不一致）。
 *
 * 依赖方向：只 import core 闭包内的件（board / reqflow / milestones / roadmap-view / lanes / subvers /
 * taskstates / style / reqid），不碰注册表 / 引导 / 席位 / manifest。落点判定**不在本模块**：
 * core 面用 `board-account.mjs`（只认板），完整 CLI 用 `target-guard.mjs`（板 + 项目），各自传 root 进来。
 *
 * 口径来源（不另立算法）：泳道 = `boardSnapshot` + 4 态机；里程碑进度 = `readBoardFacts`（与 roadmap 同源）；
 * 需求详情 = 索引条目 + 任务账 + 事件流 + 里程碑 + 子版结版 + 线主。
 */
import { join } from "node:path";
import { boardSnapshot, countTasks, readEvents, readTaskLedger, readAllLedgers, readReqEntries, TASK_STATES, TASK_TRANSITIONS } from "./board.mjs";
import { collectTasksFromRoot, readReq } from "./reqflow.mjs";
import { findTaskAnywhere } from "./board.mjs";
import { STATE_LABELS } from "./taskstates.mjs";
import { REQ_DONE_STATUSES, milestoneVersions, milestonesView, readMilestones } from "./milestones.mjs";
import { defectOf, SEVERITY_LABELS } from "./defects.mjs"; // 需求清单的缺陷标记/筛选
import { readBoardFacts } from "./roadmap-view.mjs";
import { readLanes } from "./lanes.mjs";
import { closedOf, readSubvers } from "./subvers.mjs";
import { blockedCountsByReq, depViewLines, depViewOf, depViewSummary } from "./dep-gate.mjs"; // 0.47 R-gm-104：依赖读面（与闸门同一次计算）
import { doneReworkHint } from "./rework-hint.mjs"; // 0.49.2 B-gm-000038：done 态返工指引单源
import { buildDepGraph, normalizeDeps } from "./reqdep.mjs";
import { briefLines, briefMarks, briefOfReq, briefsOfRoot } from "./req-brief.mjs"; // 0.46.1：工单三块（唯一计算）
import { out } from "./style.mjs";

/** 里程碑状态中文标签（plan 写面与读面同一张表；milestones.mjs 不带标签，故在渲染层定） */
const MS_STATUS_LABELS = { planned: "未开始", in_progress: "进行中", reached: "已达成" };

/** 需求 4 态中文标签（板上口径：需求态由任务态派生，词与任务态同名） */
const BOARD_STATUS_LABEL = { ready: "待办", in_progress: "执行中", review: "待验收", done: "已完成" };

const fmtPct = (d, t) => (t > 0 ? Math.round((d / t) * 100) : 0);
const cut = (s, n) => (String(s ?? "").length > n ? String(s).slice(0, n) + "…" : String(s ?? ""));

// ══ 看板 ═══════════════════════════════════════════════════
/**
 * 看板：4 态泳道 + 事件时间线。
 * @param {{root: string, boardId: string, boardName?: string, eventLimit?: number}} o
 * @returns {{boards: object[], lines: string[]}}
 */
export function boardView({ root, boardId, boardName = null, eventLimit = 10 }) {
  const snap = boardSnapshot(root, { eventLimit });
  const board = { pid: boardId, name: boardName ?? boardId, unpushed: 0, ...snap };
  const tasks = board.reqs.flatMap((r) => r.tasks.map((t) => ({ ...t, req: r.id })));
  const counts = countTasks(tasks);
  // 0.47 R-gm-104：被依赖卡住的任务数（按需求汇总）。判据与闸门同一份 `depViewOf` ——
  //   看板说「卡 3 条」而 work start 只拦 2 条，比不显示更糟。计算收在 `dep-gate` 里，
  //   `gd board`（req-board.mjs）与这里共用同一份，避免两套渲染各算一遍。
  const blockedOf = blockedCountsByReq(board.reqs);
  const lines = [];
  lines.push(out.ok(`📋 ${board.name}（${board.pid}）— 需求 ${board.reqs.length} · 任务 ${counts.total} · 已完成 ${counts.done}`));
  for (const state of TASK_STATES) {
    const lane = tasks.filter((t) => t.status === state);
    // 泳道 = 需求 / 任务共用面：0 任务需求按派生需求态落道（与网页看板同口径）
    const bare = board.reqs.filter((r) => r.status === state && !r.tasks.length);
    lines.push(`  ${STATE_LABELS[state]}（${state}）${lane.length || bare.length ? "" : out.dim(" —")}`);
    for (const t of lane) lines.push(`    · ${t.id} ${t.title ?? ""} ${out.dim(`@${t.executor || "未派"}${t.artifacts?.length ? ` · ${t.artifacts.length} 件` : ""}`)}`);
    for (const r of bare)
      lines.push(out.dim(`    ○ [需求] ${r.id} ${r.title ?? ""}${r.assignee ? `（暂无任务 · 归属席位 ${r.assignee} 拆任务）` : "（暂无任务 · 先指派归属席位）"}`));
  }
  // 三块齐备度（0.46.1 T-02）：整板算一次，挂到需求行上 —— 文本与 --json 同一份，不许只在文本面拼
  const briefs = briefsOfRoot(root);
  board.reqs = board.reqs.map((r) => ({ ...r, brief: briefs.get(String(r.id)) ?? briefOfReq(null, r.tasks ?? []) }));
  for (const r of board.reqs) {
    const blocked = blockedOf.get(r.id) ?? 0;
    lines.push(out.dim(`  需求 ${r.id} ${r.title} → ${r.status}`) + out.dim(`  ${briefMarks(r.brief)}`) + (blocked > 0 ? out.warn(`  ⛓ 卡 ${blocked}`) : ""));
  }
  if (board.events.length > 0) {
    lines.push(`  时间线（近 ${board.events.length} 条）:`);
    for (const e of board.events) lines.push(out.dim(`    ${e.at} ${e.actor} ${e.kind}${e.task ? ` ${e.task}` : ""}${e.state ? ` · ${e.state}` : ""}${e.text ? ` · ${e.text}` : ""}`));
  }
  return { boards: [board], lines };
}

// ══ 任务列表 ═══════════════════════════════════════════════
/**
 * 板上任务行（按需求目录顺序，扁平）。
 * @param {{root: string, boardId: string, boardName?: string, reqId?: string|null}} o
 */
export function taskRowsOf({ root, boardId, boardName = null, reqId = null }) {
  return collectTasksFromRoot(root, { reqId, projectId: boardId, projectName: boardName ?? boardId });
}

/**
 * 任务清单人读渲染（按需求分组；与完整 CLI 同形）。
 * @param {object[]} rows `taskRowsOf` 的输出
 */
export function taskListLines({ rows }) {
  const lines = [];
  const byReq = new Map();
  for (const item of rows) {
    if (!byReq.has(item.reqId)) byReq.set(item.reqId, []);
    byReq.get(item.reqId).push(item);
  }
  for (const [reqId, items] of byReq) {
    const { projectId, projectName } = items[0];
    lines.push(`# ${projectId}（${projectName}） / ${reqId}`);
    for (const { task } of items) {
      lines.push(`  ${task.id}  [${String(task.status).padEnd(11)}]  ${String(task.executor || "（未派）").padEnd(9)}  ${task.title || ""}`);
    }
  }
  lines.push(`\n共 ${rows.length} 个任务${byReq.size > 1 ? ` · ${byReq.size} 个需求` : ""}。`);
  return lines;
}

// ══ 任务详情 ═══════════════════════════════════════════════
/**
 * 任务详情（core 版：不看席位上下文 / 项目 gd.config.yaml，那些属宿主面）。
 * @returns {{ok: true, payload: object, lines: string[]} | {ok: false, error: string}}
 */
export function taskShowPlan({ root, boardId, boardName = null, taskId, reqId = null }) {
  const hit = findTaskAnywhere(root, taskId);
  if (!hit) return { ok: false, error: `任务 "${taskId}" 未找到${reqId ? `（--req ${reqId} 限定内）` : ""}` };
  if (reqId && String(hit.reqId) !== String(reqId)) return { ok: false, error: `任务 ${taskId} 属 ${hit.reqId}，与 --req ${reqId} 不符` };
  const req = readReq(root, hit.reqId);
  const task = hit.task;
  const ledgerPath = join(root, "reqs", hit.reqId, "task-list.yaml");
  const events = readEvents(root, hit.reqId).filter((e) => e.task === taskId);
  const nexts = TASK_TRANSITIONS[task.status] ?? [];
  const artifacts = task.artifacts ?? [];
  // 依赖链（0.47）：需求级 + 任务级前置一起算（与 `work start` 闸门同一份 `depViewOf`）
  const depView = depViewOf({ reqId: hit.reqId, task, ledgerTasks: readTaskLedger(root, hit.reqId).tasks, reqEntries: readReqEntries(root) });

  const payload = {
    task: { id: task.id, title: task.title, executor: task.executor, status: task.status, input: task.input ?? "", transitions: nexts },
    req: { id: hit.reqId, title: req?.title ?? null, status: req?.status ?? null },
    project: { id: boardId, name: boardName ?? boardId, dir: root },
    ledger: ledgerPath,
    deps: depView,
    artifacts: { count: artifacts.length, entries: artifacts },
    review: task.review ?? null,
    events,
  };

  const lines = [];
  lines.push(`${task.id} · ${task.title}`);
  lines.push(`  执行方     ${task.executor || "（未指定）"} · 状态 ${task.status}`);
  lines.push(`  项目/需求  ${boardId} / ${hit.reqId}${req?.status ? ` · 需求状态 ${req.status}` : ""}`);
  lines.push(`  任务账     ${ledgerPath}`);
  if (artifacts.length === 0) lines.push("  交付件     尚无");
  else {
    lines.push(`  交付件     ${artifacts.length} 件`);
    for (const a of artifacts) {
      const tags = [a.kind && a.kind !== "file" ? a.kind : "", a.seat ? `seat ${a.seat}` : "", a.checksum ? String(a.checksum).slice(0, 18) + "…" : out.warn("无指纹"), a.at].filter(Boolean).join(" · ");
      lines.push(`    ${a.path}${tags ? ` [${tags}]` : ""}`);
    }
  }
  if (task.review) lines.push(`  验收       ${task.review.verdict} · by ${task.review.by} · ${task.review.at}${task.review.note ? ` · ${task.review.note}` : ""}`);
  // 依赖链（0.47）：先一句摘要（能不能开工），再逐条前置各是什么状态
  lines.push(`  依赖       ${depViewSummary(depView)}${depView.ok ? (depView.total ? out.ok("（前置已满足）") : out.dim("（可开工）")) : out.warn("（被卡住）")}`);
  for (const line of depViewLines(depView)) lines.push(`             ${line}`);
  lines.push("  input:");
  for (const line of String(task.input ?? "").split("\n")) lines.push(`    ${line}`);
  if (events.length > 0) {
    lines.push(`  时间线（${events.length} 条）:`);
    for (const e of events) lines.push(`    ${e.at} ${e.actor} ${e.kind}${e.state ? ` · ${e.state}` : ""}${e.text ? ` · ${e.text}` : ""}`);
  }
  lines.push(`  可流转     ${task.status} → ${nexts.length ? nexts.join(" / ") : "（终态）"}`);
  // core 面下一步：只给 core 自有的命令（席位 / 注册项目命令在 core 里没有，指了也没用）
  // 0.49.2 B-gm-000038：done 态原写 `gd-core work claim`——claim 闸门对 review/done 一律拒，
  //   指引指了条死路。真实通道是验收面 reject；判据下沉 lib/rework-hint.mjs（与 `gd task show` 同一份）。
  const coreNext = { ready: [`认领：gd-core work claim ${task.id}`], in_progress: [`交件：gd-core handoff ${task.id} --done "做成了什么" --artifact <件>`], review: [`验收：gd-core check ${task.id} --pass --note "结论"`, `打回：gd-core check ${task.id} --reject "原因"`], done: [doneReworkHint({ id: task.id, prefix: "gd-core" })] }[task.status] ?? [];
  if (coreNext.length > 0) {
    lines.push("  下一步:");
    for (const t of coreNext) lines.push(`    · ${t}`);
  }
  return { ok: true, payload, lines };
}

// ══ 需求详情（板上口径） ═══════════════════════════════════
/** 板上需求详情（纯读：索引 + 任务账 + 事件流 + 里程碑 + 子版结版 + 线主 + 依赖链） */
export function buildBoardReqStatus({ root, boardId, boardName = null }, reqId) {
  const board = { root, id: boardId, name: boardName ?? boardId };
  const entries = readReqEntries(root);
  const entry = entries.find((r) => String(r.id) === String(reqId));
  if (!entry) return null;
  const facts = readBoardFacts(board);
  const ledger = readTaskLedger(root, reqId);
  const subver = String(entry.subver ?? "").trim();
  const version = subver ? subver.split(".").slice(0, 2).join(".") : "";
  const lanes = readLanes(root);
  const lane = version && lanes.ok ? lanes.list.find((l) => l.version === version) ?? null : null;
  const sv = readSubvers(root);
  const closed = closedOf(sv.ok ? sv.list : []);
  const milestone = facts.milestones.find((m) => (m.reqs ?? []).includes(reqId)) ?? null;
  const counts = { ready: 0, in_progress: 0, review: 0, done: 0 };
  for (const t of ledger.tasks) counts[String(t.status)] = (counts[String(t.status)] ?? 0) + 1;
  const events = [...readEvents(root, reqId)].sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")) || (a.seq ?? 0) - (b.seq ?? 0));
  // 依赖链（0.47）：正向边逐条解析成「账上那条 + 完成没 + 任务进度」，反向与链长一律现算
  const byId = new Map(entries.map((e) => [String(e.id), e]));
  const doneOf = (id) => String(byId.get(String(id))?.status ?? "") === "done";
  const graph = buildDepGraph(entries, { isDone: doneOf });
  const cntOf = (id) => facts.reqCounts.get(String(id)) ?? { done: 0, total: 0 };
  const depsOn = normalizeDeps(entry.depends_on).map((d) => {
    const hit = byId.get(d.id);
    const c = cntOf(d.id);
    return {
      id: d.id,
      title: String(hit?.title ?? ""),
      status: String(hit?.status ?? ""),
      done: hit ? doneOf(d.id) : true, // 悬空边：闸门按已满足放行（与 dep-gate 同口径），但读面标 missing
      missing: !hit,
      tasks: { done: c.done, total: c.total },
      why: d.why ?? "",
    };
  });
  return {
    reqId,
    title: String(entry.title ?? ""),
    status: String(entry.status ?? ""),
    // 工单三块（0.46.1 T-01）：该读什么 / 交了什么 / 怎么算过 —— 与 `gd req list` / `gd board` 同一份计算
    brief: briefOfReq(entry, ledger.tasks),
    subver,
    version,
    lane: lane ? lane.owner : "",
    milestone: milestone ? { id: milestone.id, alias: milestone.alias ?? "", target: milestone.target ?? null } : null,
    closedOn: subver && closed(subver) ? String(closed(subver).reached_on ?? "") || null : null,
    deps: {
      on: depsOn,
      dependents: (graph.dependents.get(String(reqId)) ?? []).slice(),
      depth: graph.depthOf(reqId),
    },
    tasks: {
      total: ledger.tasks.length,
      counts,
      list: ledger.tasks.map((t) => ({
        id: String(t.id),
        title: String(t.title ?? ""),
        status: String(t.status ?? ""),
        executor: String(t.executor ?? ""),
        claim: t.claim ? { session: t.claim.session ?? null, since: t.claim.since ?? null } : null,
      })),
    },
    events: (events ?? []).slice(-5).map((e) => ({ kind: e.kind, actor: e.actor, task: e.task ?? null, at: e.at ?? null, text: e.text ?? null })),
  };
}

/** 需求详情人读渲染 */
export function boardReqStatusLines(s) {
  const lines = [];
  lines.push(`${s.reqId} · ${s.title}`);
  lines.push(`  归属       板 ${out.dim("(板模式)")}${s.milestone ? ` · 里程碑 ${s.milestone.id}${s.milestone.alias ? `（${s.milestone.alias}）` : ""}` : ""}`);
  lines.push(`  状态       ${BOARD_STATUS_LABEL[s.status] ?? s.status ?? "-"}`);
  lines.push(`  子版       ${s.subver || out.dim("未编号")}${s.closedOn ? out.ok(`（已结版 ${s.closedOn}）`) : s.subver ? out.warn("（待结版）") : ""}`);
  lines.push(`  版本线     ${s.version ? `${s.version}${s.lane ? ` 归 ${s.lane}` : out.dim("（未认领）")}` : out.dim("-")}`);
  // ── 工单三块（0.46.1 T-01）──「这条需求的活有没有交付依据」的第一眼答案
  //   缺哪块就明说缺哪块并给补它的命令；不画「齐备度百分比」——那是把三件不同的事压成一个假指标
  if (s.brief) for (const line of briefLines(s.brief)) lines.push(line);
  // ── 依赖链（0.47）──「这条需求能不能动」的第一眼答案
  const dep = s.deps ?? { on: [], dependents: [], depth: 0 };
  const depCell = (d) => {
    const who = d.missing ? "账里找不到 · 悬空边" : `${d.done ? "已完成" : "未完成"}${d.tasks?.total ? ` · ${d.tasks.done}/${d.tasks.total}` : ""}`;
    return `${d.id}（${who}）${d.why ? ` — ${d.why}` : ""}`;
  };
  lines.push(`  依赖       ${dep.on.length ? depCell(dep.on[0]) : out.dim("—（无前置）")}`);
  for (const d of dep.on.slice(1)) lines.push(`             ${depCell(d)}`);
  if (dep.dependents.length) lines.push(`  被依赖     ${dep.dependents.join(" · ")}`);
  // 「还要等几层」按节点数（今天没有工期数据，按节点是唯一诚实口径）；0 层 = 不用等
  if (dep.depth > 0) lines.push(`  还要等     ${dep.depth} 层${out.dim("（按节点数，不是工期）")}`);
  lines.push("");
  const c = s.tasks.counts;
  const fmt = (k) => `${STATE_LABELS[k] ?? k}×${c[k] ?? 0}`;
  lines.push(`  任务       ${s.tasks.total} 条 —— ${["ready", "in_progress", "review", "done"].map(fmt).join(" · ")}`);
  for (const t of s.tasks.list) {
    const label = STATE_LABELS[t.status] ?? t.status;
    const claim = t.claim?.session ? out.dim(` · 占用 ${t.claim.session}`) : "";
    lines.push(`    ${t.id}  ${label}  ${out.dim(t.executor || "-")}  ${t.title}${claim}`);
  }
  if (s.events.length) {
    lines.push("");
    lines.push(out.dim("  最近事件："));
    for (const e of s.events) lines.push(out.dim(`    ${e.at ?? "-"}  ${e.kind}${e.actor ? ` by ${e.actor}` : ""}${e.task ? ` ${e.task}` : ""}${e.text ? ` · ${e.text}` : ""}`));
  }
  return lines;
}

// ══ 里程碑进度 ═════════════════════════════════════════════
/**
 * 里程碑进度（**与 roadmap 派生视图同源**：`readBoardFacts`，不另立第二套聚合）。
 * @param {{root: string, boardId: string, want?: string|null}} o `want` = 里程碑 id / alias；空 = 最早那张进行中
 * @returns {{ok: true, payload: object, lines: string[]} | {ok: false, error: string}}
 */
export function milestoneProgressPlan({ root, boardId, want = null }) {
  const facts = readBoardFacts({ root, id: boardId });
  // `want` 为空时**不要**去比 alias——空 alias 的里程碑会把 "" 匹配上（实测踩过）
  const pick = want
    ? (facts.milestones.find((x) => String(x.id) === want || String(x.alias ?? "") === want) ?? null)
    : facts.milestones.find((x) => x.is_active);
  if (!pick) {
    return {
      ok: false,
      error: want
        ? `里程碑 "${want}" 不在账里（gd-core milestone list 查看 id / alias）`
        : "没有可报的里程碑：账里一条也没有，或没有「进行中」的——点名一张：gd-core milestone progress <id>",
    };
  }
  const memberIds = Array.isArray(pick.reqs) ? pick.reqs.map(String) : [];
  const reqById = new Map(facts.reqs.map((x) => [x.id, x]));
  const reqs = memberIds.map((id) => reqById.get(id)).filter(Boolean);
  const missing = memberIds.filter((id) => !reqById.has(id)); // 账里已删的需求：不静默丢
  const cnt = (id) => facts.reqCounts.get(id) ?? { done: 0, total: 0 };
  const isDone = (x) => REQ_DONE_STATUSES.has(String(x.status));
  const subOf = (x) => (/^\d+\.\d+\.\d+$/.test(x.subver ?? "") ? x.subver : "(未编号)");
  const closed = new Set((facts.subvers ?? []).filter((s) => s.reached_on).map((s) => String(s.alias)));
  const keySort = (a, b) => (a === "(未编号)" ? 1 : b === "(未编号)" ? -1 : a.localeCompare(b, "en", { numeric: true }));
  const agg = (list) =>
    list.reduce(
      (a, x) => {
        const c = cnt(x.id);
        a.reqTotal += 1;
        a.taskTotal += c.total;
        a.taskDone += c.done;
        if (isDone(x)) a.reqDone += 1;
        else a.open.push(x);
        return a;
      },
      { reqTotal: 0, reqDone: 0, taskTotal: 0, taskDone: 0, open: [] }
    );
  // 版本 x.y → 子版 x.y.z 两级（子版号挂在需求上，两层都算：版本行给人读，子版行给结版判断）
  const byVer = new Map();
  for (const x of reqs) {
    const sub = subOf(x);
    const ver = sub === "(未编号)" ? sub : sub.split(".").slice(0, 2).join(".");
    if (!byVer.has(ver)) byVer.set(ver, new Map());
    const subs = byVer.get(ver);
    if (!subs.has(sub)) subs.set(sub, []);
    subs.get(sub).push(x);
  }
  const versions = [...byVer.entries()].sort((a, b) => keySort(a[0], b[0])).map(([alias, subs]) => {
    const total = agg([...subs.values()].flat());
    return {
      alias,
      reqs: total.reqTotal,
      reqs_done: total.reqDone,
      tasks: total.taskTotal,
      tasks_done: total.taskDone,
      status: "in_progress",
      subvers: [...subs.entries()]
        .sort((a, b) => keySort(a[0], b[0]))
        .map(([sub, list]) => {
          const a = agg(list);
          return { alias: sub, reqs: a.reqTotal, reqs_done: a.reqDone, tasks: a.taskTotal, tasks_done: a.taskDone, closed: closed.has(sub), ready: a.reqTotal > 0 && a.reqDone === a.reqTotal };
        }),
    };
  });
  // 版本聚合**由里程碑版号派生**——里程碑有版号但还没排活的版本也要点名（状态 unplanned），
  //   否则「这张里程碑的版本开工了没有」在进展速览里完全看不见（只列建过需求的版本）。
  const rangeVersions = milestoneVersions(pick);
  const haveVer = new Set(versions.map((v) => v.alias));
  for (const alias of rangeVersions) {
    if (haveVer.has(alias)) continue;
    versions.push({ alias, reqs: 0, reqs_done: 0, tasks: 0, tasks_done: 0, status: "unplanned", subvers: [] });
  }
  // 有需求的版本按完成度补 status（与 versionProgressOf 同口径：全完成 done，否则 in_progress）
  for (const v of versions) {
    if (v.status === "unplanned") continue;
    v.status = v.reqs > 0 && v.reqs_done === v.reqs ? "done" : "in_progress";
  }
  versions.sort((a, b) => keySort(a.alias, b.alias));
  // 0.49.6 F6：缺陷不占版本坐标后，里程碑里会出现「(未编号)」这一行需求。它是真事实（这些单确实没版本归属），
  //   但**它不是版本**：数版本数（`versions` / `versions_done` / 区间行）时排除它，否则 0.30~0.33 会被报成 5 个版本。
  //   需求计数（reqs / reqs_done）仍含它——那是需求数，不是版本数。
  const realVersions = versions.filter((v) => v.alias !== "(未编号)");
  const versionTotals = {
    versions: realVersions.length,
    versions_done: realVersions.filter((v) => v.status === "done").length,
    reqs: versions.reduce((a, v) => a + v.reqs, 0),
    reqs_done: versions.reduce((a, v) => a + v.reqs_done, 0),
  };
  const total = agg(reqs);
  const openReqs = [...total.open].sort((a, b) => {
    // 工作顺序：子版先后 → R 号在前（特性/杂务）→ B 号在后（缺陷）→ 各自序号
    const ka = [subOf(a), a.id.startsWith("R-") ? 0 : 1, Number(/(\d{3})/.exec(a.id)?.[1] ?? 0)];
    const kb = [subOf(b), b.id.startsWith("R-") ? 0 : 1, Number(/(\d{3})/.exec(b.id)?.[1] ?? 0)];
    return keySort(ka[0], kb[0]) || ka[1] - kb[1] || ka[2] - kb[2];
  });
  const readySubvers = versions.flatMap((v) => v.subvers.filter((s) => s.ready && !s.closed).map((s) => s.alias));
  const statusZh = MS_STATUS_LABELS[pick.status] ?? String(pick.status ?? "");
  const payload = {
    ok: true,
    board: boardId,
    milestone: {
      id: pick.id,
      name: pick.name ?? "",
      alias: pick.alias ?? null,
      status: statusZh,
      target: pick.target ?? null,
      is_active: pick.is_active === true,
      overdue_days: pick.overdue_days ?? 0,
      days_left: pick.days_left ?? 0,
      ver: pick.ver ?? null,
    },
    totals: { reqs: total.reqTotal, reqs_done: total.reqDone, tasks: total.taskTotal, tasks_done: total.taskDone, open: openReqs.length },
    version_totals: versionTotals,
    versions,
    open_reqs: openReqs.map((x) => ({ id: x.id, subver: subOf(x), title: x.title, status: x.status, tasks_done: cnt(x.id).done, tasks_total: cnt(x.id).total })),
    ready_subvers: readySubvers,
    missing_reqs: missing,
  };

  const lines = [];
  const when = pick.overdue_days > 0 ? out.warn(`逾期 ${pick.overdue_days} 天`) : pick.days_left > 0 ? `剩 ${pick.days_left} 天` : "";
  lines.push(
    `${pick.id}${pick.alias ? `（${pick.alias}）` : ""} ${pick.name ?? ""} · ${statusZh}` +
      (pick.target ? ` · 目标 ${pick.target}${when ? ` · ${when}` : ""}` : "")
  );
  lines.push(
    `需求 ${total.reqTotal} · 完成 ${total.reqDone}（${fmtPct(total.reqDone, total.reqTotal)}%）  ` +
      `任务 ${total.taskTotal} · 完成 ${total.taskDone}（${fmtPct(total.taskDone, total.taskTotal)}%）  ` +
      `未完成 ${openReqs.length} 条`
  );
  // 里程碑带版号时，版本派生进度单独报一行（版本层无结版态，只看需求完成）
  if (pick.ver) {
    lines.push(out.dim(`版本 ${pick.ver}：${versionTotals.versions} 个版本 · 已完成 ${versionTotals.versions_done} 个`));
  }
  if (versions.length > 0) {
    lines.push("按版本：");
    for (const v of versions) {
      // 该版本尚未排活（里程碑有版号但没建需求）：一行点名，不报 0/0 噪声
      if (v.status === "unplanned") {
        lines.push(`  ${String(v.alias).padEnd(10)} ${out.dim("该版本尚无需求")}`);
        continue;
      }
      const bits = [`需求 ${v.reqs} · 完成 ${v.reqs_done}`, `任务 ${v.tasks_done}/${v.tasks}`];
      const openSubs = v.subvers.filter((s) => !s.closed);
      const closedCount = v.subvers.length - openSubs.length;
      // 已结版的子版不逐条占屏（存量版线可能有十几个）——只留一句计数；只看还欠什么
      if (openSubs.length === 0) bits.push(`全部结版（${v.subvers.length} 个子版）`);
      else {
        for (const s of openSubs) bits.push(`${s.alias} ${s.ready ? "可结版" : `剩 ${s.reqs - s.reqs_done} 条`}`);
        if (closedCount > 0) bits.push(`已结版 ${closedCount} 个`);
      }
      lines.push(`  ${String(v.alias).padEnd(10)} ${bits.join(" · ")}`);
    }
  }
  if (readySubvers.length > 0) lines.push(out.ok(`可结版子版（需求全完成 · 未结版）：${readySubvers.join(" / ")}——结版须用户确认（gd-core ver reach <x.y.z> --confirm <x.y.z>）`));
  if (openReqs.length > 0) {
    lines.push(`未完成 ${openReqs.length} 条：`);
    const shown = openReqs.slice(0, 20);
    for (const x of shown) {
      const c = cnt(x.id);
      const taskCell = c.total === 0 ? "待拆" : `${c.done}/${c.total}`;
      lines.push(`  ${String(x.id).padEnd(10)} ${subOf(x).padEnd(9)} ${taskCell.padEnd(6)} ${cut(x.title, 46)}`);
    }
    if (openReqs.length > shown.length) lines.push(out.dim(`  … 另 ${openReqs.length - shown.length} 条（--json 看全量）`));
  } else {
    lines.push(out.ok("该里程碑下的需求已全部完成——可以走结版（gd-core ver reach 须点名确认）"));
  }
  if (missing.length > 0) lines.push(out.warn(`（warn）账里找不到这些关联需求：${missing.join(" / ")}——跑 gd-core milestone update ${pick.id} --req-remove <id> 收口`));
  return { ok: true, payload, lines };
}

// ── 清单类读面（`milestone list` / `req list`）─────────────────────────────

/** 定宽列填充（表头与数据行共用一套：超长不截断，短了补空格） */
const padCell = (s, n) => String(s ?? "") + " ".repeat(Math.max(0, n - String(s ?? "").length));

/**
 * 里程碑清单：只报事实——时间线顺序、版号、状态、关联需求进度、逾期。
 * @param {{root: string}} o
 * @returns {{ok: boolean, error?: string, payload?: object, lines?: string[]}}
 */
export function milestoneListPlan({ root }) {
  const ms = readMilestones(root);
  if (!ms.ok) return { ok: false, error: `里程碑账读取失败：${ms.error}` };
  const reqStatusById = Object.fromEntries(readReqEntries(root).map((r) => [String(r.id), String(r.status ?? "")]));
  const view = milestonesView(ms.list, Date.now(), { reqStatusById });
  const items = view.items.map((m) => ({
    id: String(m.id ?? ""),
    name: String(m.name ?? ""),
    alias: m.alias ?? null,
    target: m.target ?? null,
    status: String(m.status ?? ""),
    status_label: MS_STATUS_LABELS[m.status] ?? String(m.status ?? ""),
    is_active: m.is_active === true,
    overdue: m.overdue === true,
    overdue_days: m.overdue_days ?? 0,
    days_left: m.days_left ?? 0,
    ver: m.ver || null,
    reqs_done: m.reqs_done,
    reqs_total: m.reqs_total,
  }));
  const lines = [];
  if (items.length === 0) {
    lines.push(out.dim('（还没有里程碑——gd-core milestone add "<名称>" --target <YYYY-MM-DD>）'));
  } else {
    lines.push(`${padCell("里程碑", 8)} ${padCell("别名", 16)} ${padCell("目标", 12)} ${padCell("版本", 12)} ${padCell("状态", 8)} 需求`);
    for (const m of items) {
      const ver = m.ver || "-";
      const prog = m.reqs_total ? `${m.reqs_done ?? 0}/${m.reqs_total}` : "-";
      const when = m.overdue ? out.warn(`逾期${m.overdue_days}天`) : m.status_label;
      lines.push(`${padCell(m.id, 8)} ${padCell(m.alias || "-", 16)} ${padCell(m.target || "-", 12)} ${padCell(ver, 12)} ${padCell(when, 6)} ${prog}  ${m.name}`);
    }
    const active = view.summary.active_ids.join(" / ") || "无";
    lines.push("");
    lines.push(out.dim(`共 ${items.length} 张 · 已达成 ${view.summary.reached} · 进行中 ${active}`));
  }
  return { ok: true, payload: { ok: true, milestones: items, summary: view.summary }, lines };
}

// ── 板上需求清单（`req list` · 核心读面与完整 CLI 共用一份实现） ────────────

export function listBoardReqs(board, { version = null, status = null, kind = null, severity = null } = {}) {
  const facts = readBoardFacts(board);
  const entries = new Map(readReqEntries(board.root).map((e) => [String(e.id), e]));
  const entryOf = (id) => {
    const e = entries.get(String(id));
    return e ? { defect: defectOf(e) } : null;
  };
  const lanes = readLanes(board.root);
  const ownerOf = (subver) => {
    const v = String(subver ?? "").split(".").slice(0, 2).join(".");
    const hit = lanes.ok ? lanes.list.find((l) => l.version === v) : null;
    return hit?.owner ?? "";
  };
  const milestoneOf = (reqId) => facts.milestones.find((m) => (m.reqs ?? []).includes(reqId)) ?? null;
  // 三块齐备度要读任务级 artifacts（`facts.tasks` 不带件清单）⇒ 一次读全量账，不逐条重复读
  const ledgers = readAllLedgers(board.root);
  return facts.reqs
    .filter((r) => (version ? String(r.subver ?? "").startsWith(`${version}.`) : true))
    .filter((r) => (status ? String(r.status) === status : true))
    // 0.21.14：缺陷口径筛选（kind 缺省 feature；severity 只对 bug 有意义）
    .filter((r) => (kind ? entryOf(r.id)?.defect.kind === kind : true))
    .filter((r) => (severity ? entryOf(r.id)?.defect.severity === severity : true))
    .map((r) => ({ ...r, defect: entryOf(r.id)?.defect ?? null }))
    .map((r) => {
      const c = facts.reqCounts.get(r.id) ?? { done: 0, total: 0 };
      const ms = milestoneOf(r.id);
      return {
        id: r.id,
        title: r.title,
        subver: r.subver,
        status: r.status,
        tasks: { done: c.done, total: c.total },
        milestone: ms ? `${ms.id} ${ms.alias ?? ""}`.trim() : "",
        lane: ownerOf(r.subver),
        kind: entryOf(r.id)?.defect.kind ?? "feature",
        severity: entryOf(r.id)?.defect.severity ?? "",
        // 工单三块齐备度（0.46.1 T-02）：与 `gd board` 需求行、`gd req status` 同一份计算
        brief: briefOfReq(entries.get(String(r.id)), ledgers.get(String(r.id))?.tasks ?? []),
      };
    })
    .sort((a, b) => {
      const k = String(a.subver).localeCompare(String(b.subver), "en", { numeric: true });
      return k !== 0 ? k : a.id.localeCompare(b.id);
    });
}

/** 需求清单文本渲染（`req list`；`--json` 走调用方的结构化输出） */
export function renderReqList(rows) {
  if (rows.length === 0) {
    console.log(out.dim("（无匹配需求）"));
    return;
  }
  console.log(`${padCell("需求", 10)} ${padCell("子版", 9)} ${padCell("状态", 8)} ${padCell("任务", 7)} ${padCell("里程碑", 10)} ${padCell("三块", 10)} 标题`);
  for (const r of rows) {
    const label = BOARD_STATUS_LABEL[r.status] ?? r.status ?? "-";
    // 缺陷标记（0.21.14）：⌗ = 缺陷，后跟严重级；blocker 高亮
    const mark = r.kind === "bug" ? (r.severity === "blocker" ? out.err("⌗阻塞 ") : out.warn(`⌗${SEVERITY_LABELS[r.severity] ?? "缺陷"} `)) : "";
    // 三块齐备度（0.46.1 T-02）：读/交/验 各一格，缺哪块一眼看出（计算见 lib/req-brief.mjs）
    const brief = r.brief ? briefMarks(r.brief) : "";
    console.log(
      `${padCell(r.id, 10)} ${padCell(r.subver || "-", 9)} ${padCell(label, 6)} ${padCell(`${r.tasks.done}/${r.tasks.total}`, 7)} ${padCell(r.milestone || "-", 10)} ${padCell(brief || "-", 10)} ${mark}${r.title}${r.lane ? out.dim(`  〔线 ${r.lane}〕`) : ""}`,
    );
  }
  console.log("");
  const bugs = rows.filter((r) => r.kind === "bug").length;
  console.log(out.dim(`共 ${rows.length} 条${bugs ? `（其中缺陷 ${bugs}）` : ""} · 任务进度 = 已验收/总数（4 态派生）· 三块 = 读✓该读什么 / 交✓交了什么 / 验✓怎么算过`));
}

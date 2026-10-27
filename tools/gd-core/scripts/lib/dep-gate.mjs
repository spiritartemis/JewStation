/**
 * `dep-gate.mjs` — 依赖闸门的**判定**（0.47 · R-gm-104 · T-gm-104-04）
 *
 * 只回答一个问题：**这个任务现在能不能开工？** 不写账、不读环境、不打印。
 * 打印与退出码归调用方（`gd work start` / `gd work next`），这样同一份判据以后能被
 * 网页派单、`gd task show`、批量预检共用——「同一个问题在两条命令里必须是同一个答案」。
 *
 * 口径（设计稿 `docs/gd-dependency-chain-design.md` §5）：
 *   · 依赖有**两条来源**，都要算：需求条目的 `depends_on`（跨需求）＋ 任务条目的 `depends_on`（同需求）。
 *     只看任务级会漏掉「整条需求在等另一条需求」这种最常见的阻塞。
 *   · **满足判据 = `done`，不是 `landed`**：landed 会放过「合了但没验」的产出，把风险原样传给下游。
 *     任务的 done 与看板同一实现（`deriveTaskState`：status=done **且** review.verdict=pass）。
 *   · **不递归**：只算直接前置。传递性由「前置自己也有它的前置」自然保证——A 等 B、B 等 C 时，
 *     A 会因 B 未 done 而挡住，不需要把 C 也摊到 A 的脸上（摊出来反而让人以为要自己盯三层）。
 *   · **缺失不是阻塞**：前置 id 在账里找不到（被删了 / 手写错），按「已满足」处理并在 `dangling`
 *     里报出来——闸门不该因为一笔坏数据把整条线卡死，那类问题归 `gd contract check`。
 */

import { normalizeDeps } from "./reqdep.mjs";
import { deriveTaskState, STATE_LABELS } from "./taskstates.mjs";

/** 需求是否算完成（与需求态派生同口径：终态只有 done） */
const reqDone = (entry) => String(entry?.status ?? "") === "done";
/** 任务是否算完成（与看板同一实现，不另立口径） */
const taskDone = (task) => deriveTaskState(task) === "done";
/** 两种依赖的说法（把话说对：「等需求 R-x」和「等任务 T-x」不是一回事） */
const KIND_LABEL = { req: "需求", task: "任务" };

/**
 * 算某任务的**依赖视图**（每条前置边都解析成「账上那条对象 + 满足与否」）。
 *
 * 与 `depGateOf` 的关系：闸门是「能不能开工」这一个布尔结论，视图是「每条前置各是什么状态」。
 *   两者必须是**同一次计算**的两个投影 —— 否则读面说「已完成」、闸门说「在等它」，人就不信了。
 *
 * @param {object} o
 * @param {string} o.reqId           任务所属需求 id（需求级前置从这条需求的条目上取）
 * @param {object} o.task            目标任务（已归一，`depends_on` 为对象数组）
 * @param {object[]} [o.ledgerTasks] 同需求的任务清单（用于判任务级前置是否 done）
 * @param {object[]} [o.reqEntries]  需求条目清单（用于判需求级前置是否 done）
 * @returns {{ok: boolean, edges: object[], blocked: object[], dangling: string[], total: number}}
 *   `edges[]` 每项：`{id, kind, title, status, why, done, missing}` —— `done` 是**满足与否**，
 *   `missing` 是「账里没这条」（悬空边：按已满足处理，但读面要说清它不是真的完成了）。
 */
export function depViewOf({ reqId, task, ledgerTasks = [], reqEntries = [] }) {
  const reqById = new Map(reqEntries.map((r) => [String(r?.id ?? ""), r]));
  const taskById = new Map(ledgerTasks.map((t) => [String(t?.id ?? ""), t]));
  // 两条来源各配一套「怎么取 + 算不算完成」
  const sources = {
    req: { byId: reqById, done: reqDone },
    task: { byId: taskById, done: taskDone },
  };

  // 需求级在前：它是更上游的阻塞，先讲更省事
  const edges = [
    ...normalizeDeps(reqById.get(String(reqId ?? ""))?.depends_on).map((d) => ({ ...d, kind: "req" })),
    ...normalizeDeps(task?.depends_on).map((d) => ({ ...d, kind: "task" })),
  ];
  // 去重（同一 id 不该既算需求又算任务；手写脏数据时按先出现的算）
  const seen = new Set();
  const resolved = [];
  const blocked = [];
  const dangling = [];
  let total = 0;
  for (const e of edges) {
    const id = String(e.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    total++;
    const src = sources[e.kind];
    const hit = src.byId.get(id);
    if (!hit) {
      // 悬空边：闸门按已满足放行，但读面不能假装它完成了 —— `missing` 让渲染层把话说对
      dangling.push(id);
      resolved.push({ id, kind: e.kind, title: "", status: "", why: e.why ?? "", done: true, missing: true });
      continue;
    }
    const done = src.done(hit);
    const item = { id, kind: e.kind, title: String(hit.title ?? ""), status: String(hit.status ?? "") };
    resolved.push({ ...item, why: e.why ?? "", done, missing: false });
    if (!done) blocked.push(item);
  }
  return { ok: blocked.length === 0, edges: resolved, blocked, dangling, total };
}

/**
 * 算某任务的依赖闸门（**能不能开工**）。
 *
 * 只是 `depViewOf` 的一个投影：`blocked` 里那几条就是「在等谁」。
 *   分两个导出是因为调用方要的东西不同 —— 闸门要布尔，读面要逐条状态；但计算只有一份。
 *
 * @param {object} o 同 `depViewOf`
 * @returns {{ok: boolean, blocked: object[], dangling: string[], total: number}}
 *   `blocked[]` 每项：`{id, kind: "req"|"task", title, status}`（`kind` 用于把话说对：
 *   「等需求 R-x」和「等任务 T-x」不是一回事）
 */
export function depGateOf(o) {
  const v = depViewOf(o);
  return { ok: v.ok, blocked: v.blocked, dangling: v.dangling, total: v.total };
}

/**
 * 把闸门结论写成人话（CLI 与网页共用一份措辞）。
 * @param {{blocked: object[], dangling: string[]}} gate
 * @returns {string[]} 每行一句
 */
export function depGateLines(gate) {
  const lines = [];
  for (const b of gate?.blocked ?? []) {
    const who = KIND_LABEL[b.kind] ?? "依赖";
    lines.push(`在等${who} ${b.id}${b.title ? `（${b.title}）` : ""}——当前 ${b.status || "未知"}`);
  }
  for (const id of gate?.dangling ?? []) {
    lines.push(`前置 ${id} 在账里找不到（悬空边）——闸门按已满足处理，建议 gd contract check 清掉它`);
  }
  return lines;
}

/**
 * 一条前置边 → 人读一行（**纯文本，不带缩进与颜色**：缩进由调用方决定，配色由 style 决定）。
 *
 * 三种形态各说各的：
 *   · 已满足    `前置任务 T-x · done`
 *   · 未满足    `前置需求 B-x · ready ← 未满足（理由）`
 *   · 悬空      `前置任务 T-x · 账里找不到（悬空边，闸门按已满足放行）`
 *
 * 悬空边**不标「已完成」**：闸门确实放行了，但它不是完成了 —— 把两件事写成一句话，
 *   人就会以为「这条已经做过了」。
 *
 * @param {object} e `depViewOf().edges[]` 的一项
 * @returns {string}
 */
export function depEdgeLine(e) {
  const who = KIND_LABEL[e?.kind] ?? "前置";
  if (e?.missing) return `前置${who} ${e?.id ?? "?"} · 账里找不到（悬空边，闸门按已满足放行）`;
  // 任务态用中文标签（与看板同一张表）；需求态账上就是英文小写，原样更省事也不歧义
  const st = e?.kind === "task" ? (STATE_LABELS[e?.status] ?? e?.status) || "未知" : e?.status || "未知";
  const why = e?.why ? `（${e.why}）` : "";
  return `前置${who} ${e?.id ?? "?"} · ${st}${e?.done ? "" : " ← 未满足"}${why}`;
}

/**
 * 依赖视图 → 多行（`gd task show` / `gd-core task show` 共用；两边各写一遍必然漂移）。
 * @param {{edges: object[], blocked: object[]}} view
 * @returns {string[]} 空依赖返回 `[]`（调用方自己决定要不要说「无前置」）
 */
export function depViewLines(view) {
  return (view?.edges ?? []).map(depEdgeLine);
}

/**
 * 依赖视图 → 一句摘要：`前置 3 条 · 未满足 1` / `无前置`。
 * @param {{edges: object[], blocked: object[]}} view
 * @returns {string}
 */
export function depViewSummary(view) {
  const total = (view?.edges ?? []).length;
  if (total === 0) return "无前置";
  const bad = (view?.blocked ?? []).length;
  return `前置 ${total} 条 · 未满足 ${bad}`;
}

/**
 * **逐任务**算「被几条依赖卡着」（`Map<需求id, Map<任务id, 卡数>>`；没被卡的不在表里）。
 *
 * 需求级汇总（`blockedCountsByReq`）与任务行标记（`gd board` 的 `⛓ 卡 N`）都从这一次计算派生 ——
 * 判据只有一份，两个渲染层不会各算各的（R-gm-59-0：`gd board` 改版成「任务平铺」后，
 * 需求行没了落脚点，卡数一度只剩 `--json` 里有，人读面完全看不到）。
 *
 * @param {object[]} reqs 同 `blockedCountsByReq`
 * @returns {Map<string, Map<string, number>>}
 */
export function blockedTasksOf(reqs) {
  const list = Array.isArray(reqs) ? reqs : [];
  const entries = list.map((r) => ({
    id: String(r?.id ?? ""),
    title: String(r?.title ?? ""),
    status: String(r?.statusStored ?? r?.status ?? ""),
    depends_on: r?.depends_on ?? [],
  }));
  const out = new Map();
  for (const r of list) {
    const tasks = Array.isArray(r?.tasks) ? r.tasks : [];
    const per = new Map();
    for (const t of tasks) {
      const v = depViewOf({ reqId: String(r.id), task: t, ledgerTasks: tasks, reqEntries: entries });
      if (!v.ok) per.set(String(t.id), v.blocked.length);
    }
    if (per.size > 0) out.set(String(r.id), per);
  }
  return out;
}

/**
 * **看板用**：每个需求下「被依赖卡住的任务数」（`Map<需求id, 数量>`；没被卡的需求不在表里）。
 *
 * 为什么放这儿而不是各个渲染层自己算：`gd board` 与 `gd-core board` 是两套渲染（一个在
 *   `reqs/req-board.mjs`、一个在 `board-read.mjs`），各算一遍必然漂移 —— 而「卡 3 条」与
 *   「work start 拦 2 条」打架，比不显示更糟。
 *
 * 入参就是 `boardSnapshot` 的需求数组（`{id, title, statusStored, status, depends_on, tasks[]}`）。
 *   ⚠️ 需求侧**必须用账上存的 status**（`statusStored`）判完成：闸门读的是索引条目，
 *   用看板的派生态会让同一个问题在两处给出两个答案。
 *
 * 只在 `blockedTasksOf` 的结果上做一次归约，不重算依赖。
 * @param {object[]} reqs
 * @returns {Map<string, number>}
 */
export function blockedCountsByReq(reqs) {
  const out = new Map();
  for (const [reqId, per] of blockedTasksOf(reqs)) out.set(reqId, per.size);
  return out;
}

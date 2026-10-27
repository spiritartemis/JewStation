/**
 * 4 态状态词表与派生（**纯函数 · 唯一实现** · 0.16.7）
 *
 * 为什么独立成模块：这套词表与派生规则被**三方**消费——
 *   ① 看板写面（`lib/board.mjs` · `lib/boardops.mjs` · `lib/reqflow.mjs`）
 *   ② 宿主看板视图（`lib/stationview.mjs` → `/api/board` 的 `ops`）
 *   ③ **席位侧读聚合**（`lib/seatkit.mjs` → 工位台 `/api/state` 的 `ops`）
 * ③ 不能 import ①②（席位代理禁入 main 写面 / 宿主视图层，S-seat-11），
 * 而「同一份账在两端必须派生出同一个需求态」是硬要求（否则首页说 done、席位说 in_progress）。
 * ⇒ 规则住这里，写面 `board.mjs` **转出**同一份（对外 API 不变），席位侧直接引本模块。
 * 纯函数、无 node 依赖、无写面 —— 席位包带上它没有代价。
 */

/** 状态机（一套 4 态）：需求与任务同用 */
export const TASK_STATES = ["ready", "in_progress", "review", "done"];

/** 状态中文标签（渲染用；键集须与 TASK_STATES 一致） */
export const STATE_LABELS = { ready: "待办", in_progress: "执行中", review: "待验收", done: "已完成" };

/**
 * 需求级验收任务的 `kind` 标签（0.44 引入 · 0.46.2 起参与需求态派生）。
 *
 * 定义搬到这里的原因：它是**派生规则的输入**（`deriveReqState` 要按它把验收任务与工作任务分开），
 *   而本模块是「纯函数、无 node 依赖」，不能被上层模块反向依赖。
 *   `lib/req-accept-task.mjs` 仍对外转出这个名字（对外 API 不变）。
 */
export const ACCEPTANCE_TASK_KIND = "acceptance";

/** 旧账（v3 及以前）状态 → 4 态（迁移与旧账读兼容共用） */
export const LEGACY_TASK_STATUS_MAP = {
  new: "ready",
  backlog: "ready",
  dispatched: "ready",
  in_progress: "in_progress",
  done: "review",
  checked: "done",
  completed: "done",
};

/**
 * v4 账状态 → 4 态。**不可套用上面的 v3 表**：v4 的 `done` 已是验收终态
 * （v3 的 `done` 只是「交付未验收」），套用会把终态打回 `review`。
 * 故只需折 `backlog → ready`，其余状态同形直通。
 */
export const V4_TASK_STATUS_MAP = { backlog: "ready" };

/** 旧账里表示「未派」的状态字面——迁到 4 态时 executor 一并清空（未派语义，非仅改名） */
export const LEGACY_UNASSIGNED_STATES = ["new", "backlog"];

/**
 * 任务 → **派生用状态**：「已验收」以**结论面**为准，不认状态字面。
 *   终态 `done` 必须带 `review.verdict === "pass"`；无结论的 `done` 视为**待验收**
 *   （旧协议 `checked` 迁移而来、没 RVW 留痕的条目就属这类——不得靠它把需求推进到 done）。
 *   不变量由 `applyTransition`（进 done 必带 pass 结论）+ `contract check` 共同守住；
 *   本函数是最后一层防御，保证“脏数据骗不过派生”。
 */
export function deriveTaskState(task) {
  const status = String(task?.status ?? "");
  if (status !== "done") return status;
  return task?.review?.verdict === "pass" ? "done" : "review";
}

/**
 * 需求态（**唯一实现** · 0.46.2 甲-lite）。
 *
 * 判据分两层，顺序不能颠倒：
 *
 *   ① 工作任务（`kind != acceptance`）是否都收尾；
 *   ② 若这条需求**建了验收任务**，验收任务本身是否已签字通过
 *      （验收任务的 `done` 必须是 `review.verdict === "pass"`，见 `deriveTaskState`）。
 *
 * ⇒ 甲-lite 的准确措辞：**「一旦建了验收任务，就不能在没人签字之前进 done」**。
 *   没建验收任务的需求走旧路径（全任务 done ⇒ done），存量零影响 ——
 *   「要不要建验收任务」就是每条需求自己的开关，不是全局强制。
 *
 * 「部分已完成」也是 `in_progress`（0.49.6 F5）：旧规则只写了三档（全 ready / 全 done / 任一在途），
 *   于是「2 条 done + 1 条 ready」落进第一档的兼底口 ⇒ 需求显示「待办」。那不成立：已经交付了两件，
 *   它怎么也不算没开工。口径改成：**只要有一件已验收、又不是全部已验收 ⇒ `in_progress`**（“还在做，但已经在推进”）。
 *
 * 为什么把「等签字」派生为 `review` 而不是塞进 `in_progress`：需求此前只有 3 态，
 *   是因为那时**没有验收实体**；这个前提变了。把「有活在做」和「活干完等签字」糊成一档，
 *   正是本仓反复纠正过的「三态不许糊成两态」。`REQ_TERMINAL` 仍然只有 `done`。
 *
 * **判据只看任务账，不读 `acceptance.result`**：验收任务的结论面（`review.verdict`）
 *   是同一份事实在任务侧的投影，`gd req acceptance sign` 一次写两处；只看账内一处
 *   就不存在「两个来源打架」和「调用方忘了传 acceptance」这两类漏闸。
 *   两处不一致由 `contract check` 报（口径要打架就当场打架，不许静默取一个）。
 *
 * @param {object[]} tasks 任务对象数组（原样传账里的 tasks，本函数自己折状态）
 */
export function deriveReqState(tasks) {
  const list = (tasks ?? []).map((t) => {
    // 守卫放在**唯一实现**里，不放在某一层包装上：否则换一条调用路径就绕过了，
    //   而绕过后的结果不是报错，是「看起来合理的 ready」（字符串被当成空 status）。
    if (typeof t === "string") throw new TypeError("deriveReqState 需要任务对象（含 kind 与 status），不是状态字符串数组");
    return { state: deriveTaskState(t), kind: String(t?.kind ?? "") };
  });
  if (list.length === 0) return "ready";
  const work = list.filter((x) => x.kind !== ACCEPTANCE_TASK_KIND);
  const acc = list.filter((x) => x.kind === ACCEPTANCE_TASK_KIND);

  // ① 工作任务
  if (work.length > 0 && !work.every((x) => x.state === "done")) {
    if (work.some((x) => x.state === "in_progress" || x.state === "review")) return "in_progress";
    // 0.49.6 F5：有已验收的、也有没做完的 ⇒ 执行中（而不是兼底到 ready）
    if (work.some((x) => x.state === "done")) return "in_progress";
    return "ready";
  }

  // ② 验收维度：没建验收任务 ⇒ 旧路径；建了 ⇒ 必须签过字
  if (acc.length === 0) return "done";
  return acc.every((x) => x.state === "done") ? "done" : "review";
}

/** 任务账 → 派生需求态（判据走结论面，见 `deriveTaskState` / `deriveReqState`） */
export function reqStatusOfLedger(ledger) {
  return deriveReqState(ledger?.tasks ?? []);
}

/** 任务计数（总数 / 已验收 / 4 态分桶）——看板、总览、工位台需求面板共用一处口径 */
export function countTasks(tasks) {
  const byState = Object.fromEntries(TASK_STATES.map((s) => [s, 0]));
  for (const t of tasks ?? []) if (t.status in byState) byState[t.status]++;
  return { total: (tasks ?? []).length, done: byState.done, byState };
}

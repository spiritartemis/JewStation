/**
 * `lib/artifact-conflict.mjs` — 多 producer 交件的**两道判据**（m-7 · 0.70.5 · R-gm-70-5）
 *
 *   ① **同名件冲突**（`E_ARTIFACT_COLLIDE`）：同一需求内，两个**不同任务**交了**同一路径**的件。
 *      后交的那件会把先交的文件覆盖掉，而账上两条都记着"已交"——验收复算时两件指纹只有一份对得上。
 *   ② **判重**（`E_ARTIFACT_DUP` 的**反面**：不报错，静默幂等）：同一任务重复交**同一路径 + 同一指纹**，
 *      不重复入账。重复交件不是错误（重跑一次交件命令很常见），但账不该多出一条并列条目。
 *
 * ## 为什么「同一 artifact_root」这一条不在本模块判
 *
 * 需求原文是「两个 executor 在**同一 artifact_root 内**交同名相对路径」。但
 * `producer-membership.mjs` 已经立了硬闸门 `E_PM_ARTIFACT_SHARED`：**两个 binding 的 artifact_root
 * 归一后不得相同**（理由原文：「共用会让两个 binding 的 checksum 与验收基准互相污染」）。
 * 也就是说「两个 producer 共用一个产出根」在本仓**根本建不出来**。
 *
 * 所以这里判的是**这条闸门拦不住、而后果一样**的那一半：**同一个根下，两个任务交同名件**。
 * 它发生在同 executor 的两个任务、或席位代交的场景里——`artifact_root` 相同，但任务不同。
 * 再判一遍 root 共用 = 同一判据两个答案；**已经存在的闸门不重复实现**。
 *
 * ## 判据只看「路径 + 任务」，不看「内容」
 *
 * 内容相同不算冲突（那是判重管的事，且只在同一任务内成立）：两个任务各自产出同名但内容相同的件，
 * 依然是两条活各自交付的事实，账要留两条。**冲突判的是「谁的文件被谁覆盖了」，不是「内容像不像」。**
 */

/** 件账的两个拒绝码（`E_ARTIFACT_COLLIDE` 是需求点名的；判重不报错，不在此列） */
export const ARTIFACT_ERRORS = { COLLIDE: "E_ARTIFACT_COLLIDE" };

/**
 * 冲突拒单的**结构化错误**（0.70.5 · R-gm-70-5 T-02）。
 *
 * 为什么是 `Error` 而不是返回 `{ok:false}`：判据落在 `applyTransition` 里（锁内、覆盖全部写件面），
 * 而那条函数的失败口径就是抛错。带上 `code` / `conflicts` 是为了让**回显层**（`handoffOnBoard`）
 * 不用重新算一遍就能点名双方——错误对象里带结论，回显层只摆字。
 *
 * @param {{path:string, ownerTask:string, ownerExecutor:string, selfExecutor:string}[]} conflicts
 * @param {string} taskId
 * @returns {Error & {code:string, conflicts:object[]}}
 */
export function collideError(conflicts, taskId = "") {
  const lines = [
    `${ARTIFACT_ERRORS.COLLIDE}：${taskId || "本任务"} 要交的件与同需求其它任务重名（后交的会覆盖先交的文件）`,
  ];
  for (const c of conflicts) {
    lines.push(`  · ${c.path} ← 已被 ${c.ownerTask}（${c.ownerExecutor || "未派"}）交过；本次交件方 ${c.selfExecutor || "未派"}`);
  }
  lines.push(
    "  · 两条活各自的件要能区分开：换文件名（带任务 id 前缀）或换产出子目录，再交",
    "  · 同一个根下同名不是「同一件事」——账上会记两条「已交」，复算指纹却只有一份对得上",
  );
  const e = new Error(lines.join("\n"));
  e.code = ARTIFACT_ERRORS.COLLIDE;
  e.conflicts = conflicts;
  return e;
}

/**
 * 拒单的行化（**回显层共用一份**）：`handoffOnBoard` 与注册项目账的 handoff 都靠它逐行打印。
 * 两个面各写一遍切分 = 迟早一处改了另一处没改（而这类差异没人会去比对）。
 * @param {Error & {code?:string}} e
 * @returns {string[]} 首行是结论，其余是 `  · ` 指引行
 */
export function collideLines(e) {
  return String(e?.message ?? "").split("\n");
}

/** 条目是否已失效（**必须容字符串**：`parseYaml` 不转标量，账里 `superseded: true` 读回是 `"true"`） */
export function isSuperseded(a) {
  const v = a?.superseded;
  return v === true || v === "true" || v === 1 || v === "1";
}

/** 某任务当前有效件（同路径取最后一条；与 `board-ledger.currentArtifactsOf` 同一口径） */
export function liveArtifactsOf(task) {
  const live = (task?.artifacts ?? []).filter((a) => a && a.path && !isSuperseded(a));
  const last = new Map();
  for (const a of live) last.set(String(a.path), a);
  return [...last.values()];
}

/** 路径归一：`\` → `/`，去首尾空白与开头的 `./`（只做这一件事，不做大小写折叠——那是另一个判据） */
export function normPath(p) {
  return String(p ?? "")
    .trim()
    .split("\\")
    .join("/")
    .replace(/^\.\//, "");
}

/**
 * 同名件冲突判据（**写前**判，不落任何东西）。
 *
 * @param {object} p
 * @param {{id:string, executor?:string, artifacts?:object[]}[]} p.reqTasks 同需求的全部任务
 * @param {string} p.selfTaskId 本次交件的任务
 * @param {{path:string}[]} p.incoming 本次要落的件
 * @returns {{ok:boolean, code:string|null, conflicts:{path:string, ownerTask:string, ownerExecutor:string, selfExecutor:string}[]}}
 */
export function artifactCollisions({ reqTasks = [], selfTaskId, incoming = [] }) {
  const selfId = String(selfTaskId ?? "");
  const self = reqTasks.find((t) => String(t?.id ?? "") === selfId);
  const selfExecutor = String(self?.executor ?? "");
  const want = new Map();
  for (const a of incoming) {
    const p = normPath(a?.path);
    if (p) want.set(p, a);
  }
  const conflicts = [];
  if (!want.size) return { ok: true, code: null, conflicts };

  for (const t of reqTasks) {
    const id = String(t?.id ?? "");
    if (id === selfId) continue; // 同一任务内的同路径 = 判重管，不是冲突
    for (const a of liveArtifactsOf(t)) {
      const p = normPath(a.path);
      if (!want.has(p)) continue;
      conflicts.push({ path: p, ownerTask: id, ownerExecutor: String(t?.executor ?? ""), selfExecutor });
    }
  }
  conflicts.sort((x, y) => x.path.localeCompare(y.path) || x.ownerTask.localeCompare(y.ownerTask));
  return { ok: conflicts.length === 0, code: conflicts.length ? ARTIFACT_ERRORS.COLLIDE : null, conflicts };
}

/**
 * 判重：同一任务重复交**同一路径 + 同一指纹** ⇒ 不进本次条目（不重复入账）。
 *
 * 三种情况要分开，混成一种就会误判：
 *   · **同路径同指纹** ⇒ 判重（这是"我又交了一次同一份东西"，不是新事实）；
 *   · **同路径不同指纹** ⇒ 不判重（内容变了，是新事实，走 `superseded` 顶掉旧的）；
 *   · **指纹缺失**（老账 / 算不出来）⇒ 不判重（无从比较 ⇒ 不产生"相同"这个结论）。
 *
 * @param {{artifacts?:object[]}|null} task 该任务当前账上条目
 * @param {object[]} incoming 本次要落的件
 * @returns {{keep:object[], deduped:{path:string, checksum:string, at:string|null}[]}}
 */
export function dedupeArtifacts(task, incoming = []) {
  const live = new Map(liveArtifactsOf(task).map((a) => [normPath(a.path), a]));
  const keep = [];
  const deduped = [];
  for (const a of incoming) {
    const p = normPath(a?.path);
    const cur = live.get(p);
    if (cur && a?.checksum && cur.checksum && String(cur.checksum) === String(a.checksum)) {
      deduped.push({ path: p, checksum: String(a.checksum), at: cur.at ? String(cur.at) : null });
      continue;
    }
    keep.push(a);
  }
  return { keep, deduped };
}

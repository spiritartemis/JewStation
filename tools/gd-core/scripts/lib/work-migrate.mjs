/**
 * `scripts/lib/work-migrate.mjs` — **旧 `work` 块 → 工作单元**的迁移（core 层）
 *
 * 0.41 · R-gm-41-0 · T-gm-41-0-03（设计稿 `docs/gd-req-order-design.md` 附录 A.3）
 *
 * **两类旧数据分开处理**（本模块唯一的判断）：
 *   · **未收尾**（ready / in_progress / review）：真的要迁 —— 按执行体归并成 `req/<需求id>` 单元，
 *     任务改 `work_unit` 引用、删旧 `work` 块；旧工作树还活着就**沿用它的路径**（不搬、不断人手里的活）。
 *   · **已 done**（历史遗留）：**默认不动**。它们不会再走 submit/land，旧 work 块是惰性的；
 *     兼容读只会把它们当「单任务单元」，不会被误用。要清就 `pruneDone`（死块清掉，历史仍在 git 提交里）。
 *
 * **只做计划、不动账**：写盘由调用方（`gd work migrate --apply`）在板锁内完成。
 */

import { existsSync } from "node:fs";
import { ledgerBlock, readReqEntries, readTaskLedger } from "./board.mjs";
import { workUnitId } from "./workunit.mjs";

/**
 * 扫全部需求账，产出迁移计划（**只读**）。
 * @param {object} input `{boardRoot, repo}`
 * @returns {{plan:Array, legacyDone:Array, scanned:{reqs:number, tasks:number}}}
 */
export function planWorkUnitMigration({ boardRoot, repo = "" } = {}) {
  const plan = [];
  const legacyDone = [];
  let reqs = 0;
  let tasks = 0;
  for (const entry of readReqEntries(boardRoot) ?? []) {
    const reqId = String(entry?.id ?? "").trim();
    if (!reqId) continue;
    reqs++;
    const ledger = readTaskLedger(boardRoot, reqId);
    // 账里旧 work 块是**单行 JSON 字符串** ⇒ 用 ledgerBlock 归一（不归一 ⇒ 一处都扫不到）
    const withWork = ledger.tasks.filter((t) => ledgerBlock(t.work));
    if (!withWork.length) continue;
    tasks += withWork.length;
    const open = withWork.filter((t) => t.status !== "done");
    const done = withWork.filter((t) => t.status === "done");
    if (done.length) legacyDone.push({ reqId, count: done.length });
    if (!open.length) continue;

    // 按执行体归并：同需求同执行体 ⇒ 一个单元；不同执行体 ⇒ 带后缀（互不共享工作树）
    const byExec = new Map();
    for (const t of open) {
      const who = String(t.executor ?? "").trim();
      if (!byExec.has(who)) byExec.set(who, []);
      byExec.get(who).push(t);
    }
    for (const [who, list] of byExec) {
      const taken = (ledger.workUnits ?? []).map((u) => u.id);
      const unitId = workUnitId({ reqId, executor: who, taken });
      // 旧工作树还活着 ⇒ 沿用（迁移不该把人正在改的工作树搬走）
      const alive = list.find((t) => {
        const w = ledgerBlock(t.work);
        return Boolean(w?.path) && existsSync(String(w.path));
      });
      plan.push({
        reqId,
        unitId,
        executor: who,
        branch: unitId,
        path: alive ? String(ledgerBlock(alive.work).path) : "",
        base: alive ? String(ledgerBlock(alive.work).base ?? "") : "",
        reusePath: Boolean(alive),
        tasks: list.map((t) => String(t.id)),
      });
    }
  }
  return { plan, legacyDone, scanned: { reqs, tasks }, repo };
}

/**
 * 执行迁移（**写账**；调用方须已持有板锁，或复用 `mutateTaskLedger` 的锁）。
 *
 * @param {object} input
 * @param {string} input.boardRoot
 * @param {Array} input.plan  `planWorkUnitMigration` 的产物
 * @param {boolean} [input.pruneDone] 是否顺手清掉已 done 的死 work 块
 * @param {Function} input.mutate    `mutateTaskLedger(boardRoot, reqId, mutator)`
 * @param {string} [input.repo]
 * @param {string} [input.harness]   会话标识（写进单元账，可空）
 * @returns {{ok:true, units:number, reqs:number, pruned:number}}
 */
export function applyWorkUnitMigration({ boardRoot, plan = [], legacyDone = [], pruneDone = false, mutate, repo = "", session = null } = {}) {
  if (typeof mutate !== "function") throw new Error("applyWorkUnitMigration 需要 mutate（mutateTaskLedger）");
  // 要动的需求 = 有迁移计划的需求 ∪（--prune-done 时）只有历史死块的需求
  const reqIds = [...new Set([...plan.map((p) => p.reqId), ...(pruneDone ? legacyDone.map((x) => x.reqId) : [])])];
  let pruned = 0;
  for (const reqId of reqIds) {
    const plans = plan.filter((p) => p.reqId === reqId);
    mutate(boardRoot, reqId, (l) => {
      const units = Array.isArray(l.workUnits) ? [...l.workUnits] : [];
      const byTask = new Map();
      for (const p of plans) {
        for (const tid of p.tasks) byTask.set(String(tid), p);
        if (!units.some((u) => String(u.id) === p.unitId)) {
          units.push({
            id: p.unitId,
            executor: p.executor,
            branch: p.branch,
            path: p.path,
            base: p.base,
            repo: String(repo ?? "").split("\\").join("/"),
            started: new Date().toISOString(),
            session: session ? String(session) : null,
            tasks: p.tasks.map(String),
          });
        }
      }
      const tasks = l.tasks.map((t) => {
        const p = byTask.get(String(t.id));
        if (p) {
          const next = { ...t, work_unit: p.unitId };
          delete next.work; // 迁完删旧块：引用成了唯一事实
          return next;
        }
        if (pruneDone && t.status === "done" && ledgerBlock(t.work)) {
          pruned++;
          const next = { ...t };
          delete next.work;
          return next;
        }
        return t;
      });
      return { ...l, tasks, workUnits: units };
    });
  }
  return { ok: true, units: plan.length, reqs: reqIds.length, pruned };
}

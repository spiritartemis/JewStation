/**
 * `scripts/lib/workunit.mjs` — **工作单元**（work unit）的账模型与解析（core 层）
 *
 * 0.41 · R-gm-41-0 · T-gm-41-0-01（设计稿 `docs/gd-req-order-design.md` 附录 A）
 *
 * ## 是什么
 *
 * > **一个（执行体 × 需求）对应一棵工作树 + 一条分支。** 同一需求内的连续任务**共用**它。
 *
 * 现状（0.40 之前）：工作区挂在**任务**上（`task.work{branch,path,base}`）⇒
 *   同一需求的第二个任务要**另开一棵工作树**，且它的分支基于**上一棵落地前**的基线
 *   ⇒ **同需求内自己跟自己冲突**（实测撞过：并发 land 互相 rebase 打脸）。
 *
 * 改后：工作单元是需求级的一等账目（`reqs/<需求id>/task-list.yaml` 顶层 `work_units[]`），
 *   任务只**引用**它（`task.work_unit`）⇒ 同需求连续任务共用一棵工作树与一条分支。
 *
 * ## 三条硬约定
 *
 *   ① **单元 id 就是分支名**（`req/<需求id>` 或 `req/<需求id>/<执行体>`）
 *      ⇒ 零映射、排查时一眼对上 git；换执行体加后缀避免撞名。
 *   ② **兼容读**：任务上若还有旧 `work` 块（存量），就当成**单任务工作单元**就地用
 *      ⇒ 不迁也能干活；迁移是「整理」不是「必需」。
 *   ③ **占用（claim）仍是任务级**：谁此刻在干哪个任务（租约）与代码隔离（工作单元）是两回事。
 *
 * 本模块**零第三方依赖**、只读纯数据 ⇒ 可单测。
 */

/** 工作单元分支前缀（需求级） */
export const WORK_UNIT_PREFIX = "req/";

/**
 * 规整一组工作单元（**永不抛**；脏数据一律丢弃而不是带病往下传）。
 * @param {any} raw 账上的 `work_units`
 * @returns {Array<object>} 规整后的单元（按写入顺序）
 */
export function normalizeWorkUnits(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const u of list) {
    if (!u || typeof u !== "object") continue;
    const id = String(u.id ?? "").trim();
    const branch = String(u.branch ?? id).trim();
    if (!id || !branch) continue;
    if (seen.has(id)) continue; // 同 id 只留第一份（账上不该有重复）
    seen.add(id);
    out.push({
      id,
      executor: String(u.executor ?? "").trim(),
      branch,
      path: String(u.path ?? "").trim(),
      base: String(u.base ?? "").trim(),
      repo: String(u.repo ?? "").trim(),
      started: u.started ? String(u.started) : null,
      session: u.session ? String(u.session) : null,
      tasks: Array.isArray(u.tasks) ? u.tasks.map((t) => String(t)).filter(Boolean) : [],
      landed: u.landed ? { ...u.landed } : null,
    });
  }
  return out;
}

/**
 * 单元 id（分支名）——默认 `req/<需求id>`；`taken` 里有同名时加执行体后缀。
 * @param {object} input `{reqId, executor, taken}`
 * @returns {string}
 */
export function workUnitId({ reqId, executor = "", taken = [] } = {}) {
  const base = `${WORK_UNIT_PREFIX}${String(reqId ?? "").trim()}`;
  const used = new Set((Array.isArray(taken) ? taken : []).map((u) => String(u?.id ?? u ?? "")));
  if (!used.has(base)) return base;
  const who = String(executor ?? "").trim();
  const withExec = who ? `${base}/${who}` : `${base}/2`;
  if (!used.has(withExec)) return withExec;
  // 还撞 ⇒ 递增后缀（不猜：试到空位为止）
  for (let i = 2; i < 100; i++) {
    const cand = `${withExec}-${i}`;
    if (!used.has(cand)) return cand;
  }
  return `${withExec}-${Date.now().toString(36)}`;
}

/**
 * 找某需求下**属于该执行体**的工作单元。
 * @param {object} input `{units, reqId, executor}`
 * @returns {object|null}
 */
export function findUnitFor({ units, executor = "" } = {}) {
  const who = String(executor ?? "").trim();
  const list = Array.isArray(units) ? units : [];
  // 精确匹配执行体优先；无执行体信息时退回第一个（存量单元没记 executor）
  const exact = list.find((u) => u?.executor && String(u.executor) === who);
  if (exact) return exact;
  if (!who) return list[0] ?? null;
  const blank = list.find((u) => u && !u.executor);
  return blank ?? null;
}

/**
 * **解析某任务所属的工作单元**（**兼容旧 work 块**）。
 *
 * @param {object} input `{units, task}`
 * @returns {{unit:object|null, legacy:boolean}}
 *   · `unit`   单元对象（旧形态时是**就地合成的单任务单元**）
 *   · `legacy` true = 来自任务自带的旧 `work` 块（没迁）
 */
export function unitOfTask({ units, task } = {}) {
  const list = Array.isArray(units) ? units : [];
  const ref = String(task?.work_unit ?? "").trim();
  if (ref) {
    const hit = list.find((u) => String(u?.id ?? "") === ref);
    if (hit) return { unit: hit, legacy: false };
    // 引用指向的单元不在账上（被删/迁移丢失）⇒ 别静默当成没有 ⇒ 返回 null，由调用方报错
    return { unit: null, legacy: false, missing: true, ref };
  }
  // ⚠️ 账里的旧 `work` 块是**单行 JSON 字符串**（serializeTaskLedger 对未知字段就这么写）
  //   ⇒ 先归一成对象，否则兼容读会一律判「没开工」，存量任务全部 submit/land 不了。
  const w = asObject(task?.work);
  if (w && (w.path || w.branch)) {
    return {
      unit: {
        id: String(w.branch ?? "").trim() || `task/${String(task?.id ?? "")}`,
        executor: String(task?.executor ?? "").trim(),
        branch: String(w.branch ?? "").trim(),
        path: String(w.path ?? "").trim(),
        base: String(w.base ?? "").trim(),
        repo: String(w.repo ?? "").trim(),
        started: w.started ? String(w.started) : null,
        session: w.session ? String(w.session) : null,
        tasks: [String(task?.id ?? "")],
        landed: null,
      },
      legacy: true,
    };
  }
  return { unit: null, legacy: false };
}

/**
 * 单元里**还没交件**的任务（land 的闸门用）。
 *
 * 判据：任务有 `submitted` 记录（或已 `done`/`review`）⇒ 算交件过。
 *
 * ⚠️ `submitted` 在账上可能是**对象**也可能是**JSON 字符串**（gd 的 yaml 子集对未知字段
 *   尾随时写单行 JSON）⇒ 判断前先归一成对象，否则会误判成「没交件」。
 *
 * @param {object} input `{unit, tasks}`（tasks = 该需求的任务数组）
 * @returns {string[]} 未交件的任务 id
 */
export function unitUnsubmitted({ unit, tasks = [] } = {}) {
  const ids = Array.isArray(unit?.tasks) ? unit.tasks.map(String) : [];
  if (!ids.length) return [];
  const list = Array.isArray(tasks) ? tasks : [];
  const out = [];
  for (const id of ids) {
    const t = list.find((x) => String(x?.id ?? "") === id);
    if (!t) continue; // 任务已被删 ⇒ 不算未交件
    if (asObject(t.submitted)) continue;
    if (t.status === "done" || t.status === "review") continue;
    out.push(id);
  }
  return out;
}

/** 值归一成对象（对象直取 · 字符串按 JSON 解析 · 其它 ⇒ null） */
function asObject(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" && !Array.isArray(p) ? p : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * `scripts/lib/req-delivery.mjs` — 需求工单的**交付内容**与**验收方法**（core 层）
 *
 * 0.43 · R-gm-43-0 · T-gm-43-0-01（设计稿 `docs/gd-req-order-design.md` §2.2）
 *
 * ## 两块东西，一条总纲
 *
 * | 块 | 挂哪 | 是什么 | 谁写 |
 * |---|---|---|---|
 * | `delivery` | 需求条目 | 「这张工单**交了什么**」：任务级 artifacts 的**汇总视图** + 需求级说明 | 汇总派生 + 人工补 note |
 * | `acceptance` | 需求条目 | 「这张工单**怎么算过**」：`method` / `criteria[]` / `reviewer` | 人事前填（判据） |
 *
 * ## 三条硬约定（缺一条就会长出两份真相）
 *
 *   ① **交付件的事实源仍在任务级**（`task.artifacts` + `gd seat deliver` 的交货单 v5）。
 *      需求级 `delivery.artifacts` 是**汇总派生**，**不重复记账** —— 它只回答"这单整体交了哪些件"，
 *      不回答"这个件是谁在哪一轮交的"（那是任务级的事）。
 *   ② **验收方法与验收结论分开**：`acceptance.method/criteria/reviewer` 是**事前**的判据（0.43 管），
 *      `acceptance.result{}` 是**事后**的结论（0.44 管，由验收任务写）。**判据不是结论**。
 *   ③ **缺省 = 未填**：两块都可空，空就不写键（不留 `acceptance:` 空块），读侧一律 `?? null`。
 *
 * 本模块**永不抛**（校验失败返回 `{ok:false, code, error}`）。
 */

import { ledgerBlock } from "./board.mjs";
import { unquoteScalar } from "./yaml.mjs";

/** 验收判据最多几条（再多就不是判据、是愿望清单） */
export const MAX_CRITERIA = 30;

/** 验收方法 `method` 的合法取值（自由文本易漂，先给枚举 + `custom` 逃生口） */
export const ACCEPTANCE_METHODS = Object.freeze([
  "manual", // 人工按判据逐条核对
  "e2e", // 跑断言 / e2e 门禁
  "visual", // 目视（视觉 / 文案）
  "custom", // 以上都不适用，写清楚在 `method_note`
]);

/** `reviewer` 的形态：`owner` / 席位 id / `qa:<id>`（QA 席位，0.44 启用）/ 空 = 未指定 */
export const REVIEWER_RE = /^(owner|qa:[A-Za-z0-9._-]+|[A-Za-z0-9._-]+)$/;

/**
 * 把 `acceptance.reviewer` 归一成「**允许自签的席位 id**」；`null` = 没有指定的验收席位。
 *
 * 0.46.2：这个字段此前**只写不读**（全仓无闸门消费），于是「派给 qa:forge 验收」和
 *   「谁都能签」在权限上没有区别 —— 设了等于没设。接上闸门后的口径：
 *
 *   · 空 / `owner`        ⇒ `null`：验收归人（席位身份仍需 `--by-user`，与 0.16.8 收权一致）
 *   · `<席位id>` / `qa:<席位id>` ⇒ 该席位**可自签**，不需要 `--by-user`
 *     （QA 用「席位」表达，不新增 web 角色 —— 见 0.44-02 的 S-seat-17b 不变量）
 *
 * 只认这两种形态：别的一律 `null`（宁可退回「必须人签」，也不要把一个认不出的串当成授权）。
 * @param {string|null|undefined} reviewer
 * @returns {string|null}
 */
export function reviewerSeatOf(reviewer) {
  const rv = String(reviewer ?? "").trim();
  if (!rv || rv === "owner") return null;
  const seat = /^qa:/i.test(rv) ? rv.slice(3).trim() : rv;
  return seat || null;
}

/**
 * 把任务级 artifacts 汇总成需求级清单（**纯派生，不写账**）。
 *
 * 口径：
 *   · 只收**未失效**的件（`superseded !== true`）—— 失效件不该出现在"这单交了哪些件"里；
 *   · 同一 `path` 多次出现 ⇒ 取**最后一次**（后交的顶掉先交的，与任务级 superseded 语义一致）；
 *   · 带上来源任务 `task`，人点开能回到任务账对账（但**不是**第二份事实源：路径与指纹仍以任务账为准）。
 *
 * @param {object[]} tasks 该需求的任务数组（已归一）
 * @returns {{artifacts:object[], tasks_with_artifacts:number, total:number,
 *            by_executor:object[], complete:boolean, missing:object[]}}
 */
export function summarizeDelivery(tasks = []) {
  const list = Array.isArray(tasks) ? tasks : [];
  const byPath = new Map();
  const byExec = new Map(); // executor → 分组（0.70.5 R-gm-70-5 T-01）
  let tasksWith = 0;
  for (const t of list) {
    const arts = Array.isArray(t?.artifacts) ? t.artifacts : [];
    const live = arts.filter((a) => a && a.path && a.superseded !== true && a.superseded !== "true");
    if (live.length) tasksWith++;
    // ── 按 executor 分组：同一需求可能多人各交一部分，平铺一张清单看不出「谁的活还没落地」──
    //   `executor` 空 = 未派（板上正常态），照样成组并排在最后：未派任务缺件的原因与「派了没交」不同。
    const ex = String(t?.executor ?? "").trim();
    let g = byExec.get(ex);
    if (!g) {
      g = { executor: ex, tasks: [], delivered: [], missing: [], artifacts: 0 };
      byExec.set(ex, g);
    }
    const tid = String(t?.id ?? "");
    g.tasks.push(tid);
    g.artifacts += live.length;
    (live.length ? g.delivered : g.missing).push(tid);
    for (const a of live) {
      const prev = byPath.get(String(a.path));
      const at = a.at ? String(a.at) : "";
      if (prev && prev.at >= at) continue; // 后来的顶掉先前的
      byPath.set(String(a.path), {
        task: tid,
        path: String(a.path),
        kind: String(a.kind ?? "file"),
        checksum: a.checksum ? String(a.checksum) : null,
        seat: a.seat ? String(a.seat) : null,
        desc: a.desc ? String(a.desc) : "",
        at: at || null,
      });
    }
  }
  const artifacts = [...byPath.values()].sort((x, y) => String(x.path).localeCompare(String(y.path)));
  // 分组排序：有 executor 的按名字，未派垫底（人先看「谁在交」，再看「谁还没人接」）
  const by_executor = [...byExec.values()]
    .map((g) => ({ ...g, complete: g.missing.length === 0 }))
    .sort((a, b) => (a.executor === b.executor ? 0 : a.executor === "" ? 1 : b.executor === "" ? -1 : a.executor.localeCompare(b.executor)));
  // 「缺谁」：任务 id + 谁负责 + 当前状态——只说「缺 2 个」等于让人回去翻账
  const statusOf = new Map(list.map((t) => [String(t?.id ?? ""), String(t?.status ?? "")]));
  const missing = [];
  for (const g of by_executor) for (const id of g.missing) missing.push({ task: id, executor: g.executor, status: statusOf.get(id) ?? "" });
  // **三态，不许糊成两态**（0.70.5）：一件都没登记 ≠ 缺件。
  //   件账在本仓是**选填**的（只改代码、走 git 交付的任务不会有 `artifacts[]`）——把这种需求报成
  //   「缺 4 个任务的交付件」是**假告警**，而假告警会教人「这个提示是正常的」，从此整条读面失效。
  //   所以：一件都没有 ⇒ `complete: null`（未使用件账，不产生齐缺结论）；有件 ⇒ 才谈齐缺。
  const used = artifacts.length > 0;
  return {
    artifacts,
    tasks_with_artifacts: tasksWith,
    total: artifacts.length,
    by_executor,
    complete: used ? missing.length === 0 : null,
    missing,
    ledger_used: used,
  };
}

/**
 * 把 `summarizeDelivery` 的 executor 分组渲染成人读几行（0.70.5 R-gm-70-5 T-01）。
 *
 * 为什么是「渲染一层」而不是再算一遍：分组、齐缺、缺谁的判据全在 `summarizeDelivery` 里，
 * 本函数**只摆字**——同一判据两个渲染层会给出两个答案（`--json` 与文本各一套口径是这类缺陷的经典形态）。
 *
 * 三条口径：
 *   · **`executor` 空 = 未派**，照样成组、排在最后：未派任务缺件的原因（没人接）与「派了没交」不同；
 *   · 分组行给 `任务 已交/总数`，**缺的直接点名带状态**——只说「缺 1 个」等于让人回去翻账；
 *   · 汇总行只回答一件事：**齐，还是缺谁**。
 *
 * @param {{by_executor?:object[], complete?:boolean, missing?:object[]}} sum `summarizeDelivery` 的返回值
 * @returns {string[]} 已带缩进的行（无颜色：lib 层零 style 依赖）
 */
export function renderByExecutor(sum) {
  const groups = Array.isArray(sum?.by_executor) ? sum.by_executor : [];
  if (!groups.length) return [];
  const statusOf = new Map((Array.isArray(sum?.missing) ? sum.missing : []).map((m) => [String(m.task), String(m.status ?? "")]));
  const short = (id) => String(id);
  // 未使用件账时**全篇不提齐缺**：标题也不许写「齐 0 / 缺 1」——否则同一屏上「缺 1」与
  // 「不产生齐缺结论」并存，读的人只会记住前一句（自相矛盾的读面比没有读面更坏）。
  const used = sum?.ledger_used !== false && sum?.complete !== null;
  const doneGroups = groups.filter((g) => g.complete).length;
  const lines = [
    used
      ? `  按 executor 分组（${groups.length} 组 · 齐 ${doneGroups} / 缺 ${groups.length - doneGroups}）：`
      : `  按 executor 分组（${groups.length} 组 · 未使用件账）：`,
  ];
  for (const g of groups) {
    const who = g.executor || "未派";
    const head = `    · ${who}：${g.artifacts} 件 · 任务 ${g.delivered.length}/${g.tasks.length}`;
    if (!used) {
      lines.push(head);
      continue;
    }
    if (g.complete) {
      lines.push(`${head} 齐`);
      continue;
    }
    const miss = g.missing.map((id) => {
      const st = statusOf.get(String(id)) ?? "";
      return st ? `${short(id)}（${st}）` : short(id);
    });
    lines.push(`${head} · 缺 ${miss.join("、")}`);
  }
  const missing = Array.isArray(sum?.missing) ? sum.missing : [];
  if (!used) {
    // 未使用件账：照样给分组（谁负责哪些任务是有用的事实），但**不给齐缺结论**
    lines.push(`  齐缺：本需求未使用件账（0 件登记）——不产生齐缺结论（只走 git 交付的任务不会有件）`);
    return lines;
  }
  if (!missing.length) {
    lines.push(`  齐缺：齐 —— ${groups.reduce((n, g) => n + g.tasks.length, 0)} 个任务都有交付件`);
  } else {
    const who = missing.map((m) => `${short(m.task)}（${m.executor || "未派"}${m.status ? ` · ${m.status}` : ""}）`);
    lines.push(`  齐缺：缺 ${missing.length} 个任务的交付件 —— ${who.join("、")}`);
    lines.push(`    （件账选填：纯 git 交付、没登记件的任务也会出现在这里）`);
  }
  return lines;
}

/**
 * 规整交付块（读侧用；**永不抛**）。
 * @param {any} raw 账上的 `delivery`
 * @returns {{artifacts:object[], note:string, at:string|null}|null}
 */
export function normalizeDelivery(raw) {
  const d = ledgerBlock(raw); // 账上可能是单行 JSON 字符串（未知字段一律这么写）
  if (!d) return null;
  const arts = Array.isArray(d.artifacts)
    ? d.artifacts
        .filter((a) => a && a.path)
        .map((a) => ({
          task: a.task ? String(a.task) : null,
          path: String(a.path),
          kind: String(a.kind ?? "file"),
          checksum: a.checksum ? String(a.checksum) : null,
          seat: a.seat ? String(a.seat) : null,
          desc: a.desc ? String(a.desc) : "",
          at: a.at ? String(a.at) : null,
        }))
    : [];
  return { artifacts: arts, note: String(d.note ?? ""), at: d.at ? String(d.at) : null };
}

/**
 * 校验并规整**验收方法**（事前判据）。**不含** `result`（那是 0.44 的验收结论）。
 *
 * @param {object} input `{method, method_note, criteria, reviewer, criteriaBy}`
 * @returns {{ok:true, acceptance:object} | {ok:false, code:string, error:string}}
 */
export function buildAcceptance({ method = null, methodNote = null, criteria = null, reviewer = null, criteriaBy = null } = {}) {
  const m = String(method ?? "").trim().toLowerCase();
  if (m && !ACCEPTANCE_METHODS.includes(m)) {
    return { ok: false, code: "E_ACC_METHOD", error: `method 非法："${m}"（可用：${ACCEPTANCE_METHODS.join(" / ")}）` };
  }
  const crit = Array.isArray(criteria) ? criteria.map((c) => String(c ?? "").trim()).filter(Boolean) : [];
  if (crit.length > MAX_CRITERIA) {
    return { ok: false, code: "E_ACC_CRITERIA", error: `判据最多 ${MAX_CRITERIA} 条（再多就不是判据、是愿望清单）` };
  }
  const rv = String(reviewer ?? "").trim();
  if (rv && !REVIEWER_RE.test(rv)) {
    return { ok: false, code: "E_ACC_REVIEWER", error: `reviewer 非法："${rv}"（用 owner / 席位 id / qa:<席位>）` };
  }
  if (!m && !crit.length && !rv) {
    return { ok: false, code: "E_ACC_EMPTY", error: "至少给一项：--method / --criteria（可重复）/ --reviewer" };
  }
  return {
    ok: true,
    acceptance: {
      method: m || null,
      method_note: methodNote ? String(methodNote).trim() : "",
      criteria: crit,
      reviewer: rv || null,
      // 0.46.2：**判据是谁写的**。签字人 == 判据作者 ⇒ 自判（写进 result.note，warn 不阻断）。
      //   没写判据就不记作者（空判据没有「作者」可言）；调用方没给就留空，读侧按「未知」处理。
      criteria_by: crit.length ? String(criteriaBy ?? "").trim() || null : null,
    },
  };
}

/**
 * 规整验收方法（读侧用；**永不抛**）。保留 `result`（0.44 写的结论），因为读的人要一起看。
 * @param {any} raw 账上的 `acceptance`
 * @returns {object|null}
 */
export function normalizeAcceptance(raw) {
  const a = ledgerBlock(raw);
  if (!a) return null;
  const m = String(a.method ?? "").trim().toLowerCase();
  return {
    method: ACCEPTANCE_METHODS.includes(m) ? m : m ? String(a.method) : null,
    method_note: String(a.method_note ?? ""),
    // 账里的判据是带引号的 YAML 标量（写侧 JSON.stringify 保特殊字符）⇒ 读侧归一，否则每轮 set 都会再逃逸一层
    criteria: Array.isArray(a.criteria) ? a.criteria.map((c) => unquoteScalar(String(c ?? ""))).filter(Boolean) : [],
    reviewer: a.reviewer ? String(a.reviewer) : null,
    // 0.46.2：判据作者（自判留痕用）；老账没这个键 ⇒ null，不按今天的默认值回填
    criteria_by: a.criteria_by ? String(a.criteria_by) : null,
    // 0.44：验收结论（这里只透传，不产生）
    result: ledgerBlock(a.result) ?? null,
  };
}

/**
 * 需求级**交付说明**能不能改：有已验收结论（`result.verdict === "pass"`）后就不许再改判据/说明
 * （否则「验收通过」之后把交付说明一改，账面就自相矛盾）。
 *
 * @param {object|null} acceptance 已规整的验收块
 * @returns {{ok:true} | {ok:false, code:string, error:string}}
 */
export function assertAcceptanceEditable(acceptance) {
  const v = acceptance?.result?.verdict;
  if (v === "pass") {
    return {
      ok: false,
      code: "E_ACC_LOCKED",
      error: "该需求已验收通过（acceptance.result.verdict=pass）——判据与交付说明不再改；确有偏差请开新需求或走缺陷单",
    };
  }
  return { ok: true };
}

/**
 * **单一事实源守则**（0.43 · T-gm-43-0-03）：需求级 `delivery.artifacts` 只能是**任务级的派生副本**。
 *
 * 判据（三处任一不合即 drift）：
 *   ① 任务级有的件，需求级没有；② 需求级有的件，任务级已没有；③ 同一 path 的 checksum 不一致。
 *
 * **为什么要有这条守卫**：一旦两边都能改，账上就会出现「写着交了 A、任务账说交的是 B」，
 *   而验收人按需求级签名 —— 双真相的分歧点恰好落在最不能含糊的地方。
 *
 * @param {object} input `{delivery, tasks}`（delivery 可为未规整的原始值）
 * @returns {{ok:boolean, drift:Array<{kind:string, path:string, detail:string}>, saved:number, derived:number}}
 */
export function auditDeliveryDrift({ delivery = null, tasks = [] } = {}) {
  const saved = normalizeDelivery(delivery);
  const derived = summarizeDelivery(tasks);
  const drift = [];
  if (!saved) return { ok: true, drift, saved: 0, derived: derived.total };
  const byPath = new Map(saved.artifacts.map((a) => [a.path, a]));
  const dPath = new Map(derived.artifacts.map((a) => [a.path, a]));
  for (const [path, a] of dPath) {
    if (!byPath.has(path)) {
      drift.push({ kind: "missing-in-saved", path, detail: "任务账里有、需求级汇总里没有" });
      continue;
    }
    const cur = byPath.get(path);
    if (a.checksum && cur.checksum && a.checksum !== cur.checksum) {
      drift.push({ kind: "checksum", path, detail: `任务级 ${String(a.checksum).slice(0, 15)}… vs 需求级 ${String(cur.checksum).slice(0, 15)}…` });
    }
  }
  for (const [path] of byPath) {
    if (!dPath.has(path)) {
      drift.push({ kind: "stale-in-saved", path, detail: "需求级汇总里有、任务账里已没有（件被顶掉或删了）" });
    }
  }
  return { ok: drift.length === 0, drift, saved: saved.artifacts.length, derived: derived.total };
}

/** 人话摘要（席位 / 验收人看的；空 ⇒ 明说未填，不留白） */
export function renderAcceptance(acc) {
  if (!acc) return ["（验收方法未填——owner 该在指派前写清「怎么算过」：gd req acceptance set …）"];
  const lines = [];
  if (acc.method) lines.push(`方法：${acc.method}${acc.method_note ? `（${acc.method_note}）` : ""}`);
  if (acc.reviewer) lines.push(`验收人：${acc.reviewer}`);
  if (acc.criteria?.length) {
    lines.push(`判据（${acc.criteria.length}）：`);
    for (const c of acc.criteria) lines.push(`  · ${c}`);
  } else {
    lines.push("判据：（未填）");
  }
  if (acc.result) lines.push(`结论：${acc.result.verdict ?? "?"}${acc.result.by ? ` by ${acc.result.by}` : ""}${acc.result.note ? ` —— ${acc.result.note}` : ""}`);
  // 0.46.2：判据作者（读面也看得见 —— 只在 `result.note` 里写「自判」，不翻账面就看不见）
  if (acc.criteria_by) {
    const self = acc.result?.by && String(acc.result.by) === String(acc.criteria_by);
    lines.push(`判据作者：${acc.criteria_by}${self ? "（自判：判据与验收同一人）" : ""}`);
  }
  return lines;
}

/**
 * 把规整后的 `acceptance` **写回 YAML 块文本**（`upsertReqIndexBlock` 只接文本，不接对象）。
 *
 * 0.46.2 从 `scripts/reqs/req-delivery.mjs` 移到 lib：`lib/req-accept-result.mjs`（结论落账的唯一实现）
 * 也要用它，而 reqs 侧本来就 import lib —— 留在 reqs 会形成 lib → reqs → lib 的循环。
 * 纯函数（只 JSON.stringify 特殊字符），不碰磁盘。
 */
export function renderAcceptanceBlock(a) {
  const lines = [];
  if (a.method) lines.push(`method: ${a.method}`);
  if (a.method_note) lines.push(`method_note: ${JSON.stringify(a.method_note)}`);
  const crit = Array.isArray(a.criteria) ? a.criteria : [];
  if (crit.length) {
    lines.push("criteria:");
    for (const c of crit) lines.push(`  - ${JSON.stringify(c)}`);
  }
  if (a.reviewer) lines.push(`reviewer: ${a.reviewer}`);
  // 0.46.2：判据作者（actor id，正常字面量；与 result.by 同口径）
  if (a.criteria_by) lines.push(`criteria_by: ${a.criteria_by}`);
  const r = a.result && typeof a.result === "object" ? a.result : null;
  if (r && r.verdict) {
    lines.push("result:");
    lines.push(`  verdict: ${r.verdict}`);
    if (r.by) lines.push(`  by: ${r.by}`); // actor id，正常字面量；带引号会让读侧多一层
    if (r.at) lines.push(`  at: ${r.at}`);
    if (r.note) lines.push(`  note: ${JSON.stringify(r.note)}`);
    const ev = Array.isArray(r.evidence) ? r.evidence.filter(Boolean) : [];
    if (ev.length) {
      lines.push("  evidence:");
      for (const e of ev) lines.push(`    - ${JSON.stringify(String(e))}`);
    }
  }
  return lines.join("\n");
}

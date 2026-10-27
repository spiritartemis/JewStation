/**
 * `scripts/lib/reqdep.mjs` — **依赖边**（dependency edge）的账模型与读写归一（core 层）
 *
 * 0.47 · R-gm-104 · T-gm-104-02（设计稿 `docs/gd-dependency-chain-design.md` §2）
 *
 * ## 是什么
 *
 * > **「A 没做完就开工 B，会不会产出错的东西」—— 会，就是一条依赖边。**
 *
 * 边是**前置关系**，不是排期、不是包含、不是相关。判据只有这一句（§1 的边界表）：
 *   其余关系（父子 / 相关 / 同批 / 参考）都不该进这个字段。
 *
 * ## 落在哪（按**作用域**分，不按 id 前缀判语义）
 *
 * | 边 | 落点 | 校验 |
 * |---|---|---|
 * | 需求 → 需求（跨需求） | 需求条目 `reqs/index.yaml` 的 `depends_on` | 前置须是需求/缺陷 id |
 * | 任务 → 任务（**只许同需求**） | 任务条目 `reqs/<需求id>/task-list.yaml` 的 `depends_on` | 前置须是**本需求**的任务 id |
 *
 * 为什么这么分：任务级依赖跨需求 = 绕开工作单元（一棵树一条分支）；真需要就合并需求或重切任务，
 *   而不是在边上开口子（§2.5）。
 *
 * ## 边的形状：**用对象，不用标量**
 *
 * ```yaml
 * depends_on:
 *   - id: B-gm-000017
 *     why: sign 必须先落地，否则闸门没有非人工签字入口   # 可选 · 人读
 *     at: 2026-10-24T00:20:00Z                          # 写面自动
 *     by: local                                          # 写面自动
 * ```
 *
 * 真正的决定只有「容器形态」这一条 —— 形态（标量 ↔ 对象）改了要**迁移每一条已有边**，
 *   而对象里**加键**是零迁移的纯增量。所以现在把形态定死成对象，`why/at/by` 顺带放进来（§2.3）。
 *
 * ## 三条硬约定
 *
 *   ① **读宽容、写严格**：手写 `depends_on: [B-gm-000017]`（标量数组）读侧归一成 `{id}`；
 *      写侧**只写对象**。不为兼容而把写面放松。
 *   ② **缺省不写该字段**（不写 `depends_on: []`）——空数组与「没有这个字段」在读面上是一回事，
 *      写进去只是噪音；更要紧的是**会掩盖「谁真的加过依赖」**。
 *   ③ **只存正向边**：`dependents`（谁依赖我）一律派生，不落账。反向索引没有自己的语义，
 *      存它等于造一个必须同步的副本 —— 本仓为此踩过不止一次（§2.4）。
 *
 * ## 两个读点都要过 `normalizeDeps`（已接，新增读点请照做）
 *
 *   · `reqflow.mjs: readIndex()`      —— 项目账路径 / req-* 命令
 *   · `board.mjs:  readReqEntries()`  —— 板模式路径
 *   （两处各解析一次 index.yaml，彼此不能互相 import：reqflow 已依赖 board，反向会成环。
 *     所以「归一」这件事必须写在**本模块**、由两处分别调用，而不是各写一遍。）
 *   任务侧只有一处：`board.mjs: normalizeTask()`。
 *
 * 本模块**零依赖**（连 `yaml.mjs` 都不 import —— 见 `txt()`：**刻意不用** `unquoteScalar`，
 *   它会 trim + 剥引号壳，把「理由末尾的引号」和「尾随空格」吃掉）、只读纯数据 ⇒ 可单测。
 */

/** 账上字段名（两处都用它，避免各写字符串拼错） */
export const DEP_KEY = "depends_on";

/** 边里除 `id` 外的已知键（at / by；`why` 单列 —— 它是自由文本，归一规则与受控标量不同） */
const EDGE_EXTRA_KEYS = ["at", "by"];

/**
 * 值归一成字符串（**只解写侧加过的引号，绝不改写正文**）。
 *
 * ⚠️ 不能直接用 `unquoteScalar`（第一版就是这么写的，实测吃掉正文）：
 *   它对「不以引号开头」的裸值会执行 `t.trim()` + `replace(/^["']+|["']+$/g, "")`，
 *   于是 `why: 理由里带 '单引号'` 读回来变成 `理由里带 '单引号`（末尾单引号被当引号壳剥掉），
 *   尾随空格也被 trim —— **读侧静默改写人写的内容**，正是本仓最怕的那类「看起来写进去了」。
 *
 * 本函数只做一件事：把写侧（`edgeItemLines` / `bare()`）加过的引号解回去。
 *   写侧加引号只有一种形态（`JSON.stringify`）⇒ 只认「整串是一个合法 JSON 字符串字面量」。
 *   其余一律**原样返回**（手写的 `why: 'x'` 就带着引号显示 —— 宁可看见一个多余的引号，
 *   也不要悄悄少一个字）。
 */
function txt(v) {
  if (v === undefined || v === null) return "";
  const s = String(v);
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      const p = JSON.parse(s);
      if (typeof p === "string") return p;
    } catch {
      /* 不是合法 JSON 字面量（如 `"a" "b"`）⇒ 原样，不剥壳 */
    }
  }
  return s;
}

/**
 * **受控标量**归一（id / at / by）：解引号后再 trim。
 * 与 `txt` 分开的理由：这三个是机器形态（id、ISO 时间、actor id），首尾空白没有意义 ⇒ 归一时去掉；
 *   而 `why` 是人写的理由，**首尾空白必须原样保留**（否则又是一次静默改写）。
 */
function tok(v) {
  return txt(v).trim();
}

/**
 * 原始值 → 边数组（**永不抛**；脏数据一律丢弃而不是带病往下传）。
 *
 * 容忍三种形态（都是真实会出现的手写/历史形态）：
 *   ① 对象数组 `[{id, why}]`  —— 写侧的标准形态
 *   ② 标量数组 `["R-x", "R-y"]` —— 手写简写，归一成 `{id}`
 *   ③ 单行 JSON 字符串 `'[{"id":"R-x"}]'` —— 本仓 yaml 子集对「未知字段」尾随时的写法
 *      （`work` / `submitted` 块都撞过这个坑 ⇒ 这里先兜住，不让读侧误判成「没有依赖」）
 *
 * 同 id 只留**第一份**（账上不该有重复；重复意味着写面出过 bug，读侧不放大它）。
 *
 * @param {any} raw 账上的 `depends_on`
 * @returns {Array<{id: string, why?: string, at?: string, by?: string}>}
 */
export function normalizeDeps(raw) {
  let list = raw;
  if (typeof list === "string") {
    try {
      const p = JSON.parse(list);
      list = Array.isArray(p) ? p : [];
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const scalar = typeof item === "string" || typeof item === "number";
    if (!scalar && (!item || typeof item !== "object" || Array.isArray(item))) continue;
    // ①① 标量简写直接当 id；对象形态取 `id`，`ref` 是手写/前端可能用到的别名
    const id = scalar ? String(item).trim() : tok(item.id ?? item.ref ?? "");
    if (!id || seen.has(id)) continue; // 同 id 也只留第一份
    seen.add(id);
    const edge = { id };
    if (!scalar) {
      // why = 人写的理由（原文保留，仅「全是空白」视为没写）；at / by = 受控形态（trim）
      const why = txt(item.why);
      if (why.trim() !== "") edge.why = why;
      for (const k of EDGE_EXTRA_KEYS) {
        const v = tok(item[k]);
        if (v !== "") edge[k] = v;
      }
    }
    out.push(edge);
  }
  return out;
}

/**
 * 边数组 → id 数组（判环 / 闸门 / 反向邻接都用它）。
 * @param {any} deps
 * @returns {string[]}
 */
export function depIds(deps) {
  return normalizeDeps(deps).map((d) => d.id);
}

/**
 * **加一条边**（按 id 覆盖：同 id 已存在则用新边替换，位置保持原序）。
 *
 * 覆盖而非追加的理由：重复 id 的边是脏数据；「再 add 一次」的意图是「把理由改成这个」，
 *   而不是「记两条」。位置不动是为了让账上 diff 只落在改动的行上。
 *
 * @param {any} deps 现有边（容忍任意形态）
 * @param {{id: string, why?: string, at?: string, by?: string}} edge 新边（`id` 必填，其余空则不带）
 * @returns {Array<object>} 新数组（不改入参）
 */
export function upsertDep(deps, edge) {
  const list = normalizeDeps(deps);
  const next = normalizeDeps([edge]);
  if (next.length === 0) return list;
  const one = next[0];
  const i = list.findIndex((d) => d.id === one.id);
  if (i < 0) return [...list, one];
  const out = list.slice();
  out[i] = one;
  return out;
}

/**
 * **删一条边**。id 不存在 ⇒ 原样返回（幂等；调用方可用长度差判「有没有真删」）。
 * @param {any} deps
 * @param {string} id
 * @returns {Array<object>}
 */
export function removeDep(deps, id) {
  const target = String(id ?? "").trim();
  return normalizeDeps(deps).filter((d) => d.id !== target);
}

/**
 * 边 → YAML 行（可指定缩进基准；任务账用 4、需求条目块用 0）。
 *
 * **空列表返回 `[]`**（不写 `depends_on:` 空块）—— 见文件头约定 ②。
 *
 * @param {any} deps
 * @param {number} [indent] 行首缩进（空格数）
 * @returns {string[]}
 */
export function depLines(deps, indent = 0) {
  const pad = " ".repeat(Math.max(0, Number(indent) || 0));
  const items = edgeItemLines(deps, `${pad}  `);
  if (items.length === 0) return [];
  return [`${pad}${DEP_KEY}:`, ...items];
}

/**
 * 边 → **只有条目行**（不含 `depends_on:` 块头；条目本身从 `pad` 起排，键值再 +2）。
 *
 * 存在的理由：`upsertReqIndexBlock(projDir, reqId, key, blockText)` **自己会写 `    <key>:`**，
 *   块文本只该是条目体。第一版把块头也拼进去 ⇒ 账上出现 `depends_on:` 套 `depends_on:`（实测踩到）。
 *
 * @param {any} deps
 * @param {string} [pad] 条目行首缩进字符串
 * @returns {string[]}
 */
function edgeItemLines(deps, pad = "") {
  const list = normalizeDeps(deps);
  const out = [];
  for (const d of list) {
    out.push(`${pad}- id: ${bare(d.id)}`);
    // why 是**自由文本**（人写的理由）⇒ 一律加引号：裸值遇到 ` #`（被当注释截断）、
    //   行首 `-`/`[`/`{`/`|`（被当结构解析）都会静默走形，而这恰恰是「看起来写进去了、读回来不是那句话」的坑。
    //   与本仓 `renderAcceptanceBlock` 写 note / criteria 同一口径。
    if (d.why) out.push(`${pad}  why: ${JSON.stringify(d.why)}`);
    // at / by 是**受控形态**（ISO 时间 / actor id，由写面填）⇒ 裸写，账上更像人话；异常字符才加引号
    if (d.at) out.push(`${pad}  at: ${bare(d.at)}`);
    if (d.by) out.push(`${pad}  by: ${bare(d.by)}`);
  }
  return out;
}

/**
 * 受控标量落值：默认裸写；仅在**读侧会走形**时才加引号（含 ` #`、行首引号、空串）。
 * 加引号一律走 `JSON.stringify`（内部引号被正确转义），读侧 `unquoteScalar` 按 JSON 还原 ⇒ 无损。
 * 不直接用 `board.mjs` 的 `scalar()`：那个把内部 `"` 换成 `'`（有损），对 id 之外的键不安全。
 * @param {any} v
 * @returns {string}
 */
function bare(v) {
  const s = String(v ?? "");
  return /\s#|^["']|^\s*$/.test(s) ? JSON.stringify(s) : s;
}

/**
 * 边 → 需求条目内的**块文本**（0 基准缩进，交给 `upsertReqIndexBlock` 统一 +4/+6）。
 *
 * ⚠️ **不含 `depends_on:` 块头**（那个由 `upsertReqIndexBlock` 写）。
 * 空列表返回 `""`（调用方应改走 `removeReqIndexBlock` 删块，别留空键）。
 *
 * @param {any} deps
 * @returns {string}
 */
export function renderDepsBlock(deps) {
  return edgeItemLines(deps, "").join("\n");
}

/**
 * 边 → 结构化的「人读一行」（读面 / `--json` 之外的文本输出用；不含缩进与颜色）。
 * 例：`B-gm-000017（sign 必须先落地）`
 * @param {object} edge
 * @returns {string}
 */
export function depLabel(edge) {
  const id = tok(edge?.id);
  const why = txt(edge?.why);
  return why ? `${id}（${why}）` : id;
}

// ══ 图：邻接 / 判环 / 反向邻接 / 链长 ═══════════════════════════════════════
//
// 三条纪律（设计稿 §2.4 / §6.1 / §6.2）：
//   ① **只存正向边**（我依赖谁），反向一律现算 —— 反向是纯镜像，存它等于造一个必须同步的副本。
//   ② **判环是纯函数**，`--dry-run` 不写盘就能拿到结构化 `cycle: [id…]` —— 前端要「选前置时就
//      知道会不会成环」，只给一句「成环了」不够，要节点序列才能把红边画出来。
//   ③ **一个统一邻接视图**（`buildDepGraph`），CLI / 网页 / 未来视图都调它 ——
//      两个前端各自拼图，迟早给出两个答案。

/**
 * 条目数组 → 邻接表（`Map<id, 前置 id 数组>`）。
 * @param {Array<object>} entries 需求条目或任务条目
 * @param {{idOf?: (e:object)=>string, depsOf?: (e:any)=>any}} [opts]
 * @returns {Map<string, string[]>}
 */
export function depEdges(entries, { idOf = (e) => e?.id, depsOf = (e) => e?.depends_on } = {}) {
  const out = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    const id = tok(idOf(e));
    if (!id) continue;
    out.set(id, depIds(depsOf(e)));
  }
  return out;
}

/**
 * **判环**：从 `from` 沿 depends_on 出发，能否回到 `target`。
 *
 * 用途：建边 `target → from`（target 依赖 from）之前调一次 ——
 *   若 `from` 已经能走回 `target`，这条边就把图接成环了。
 *
 * 返回**完整环路径**（`[target, from, …, target]`），无环返回 `null`。
 * 只回「成环了」等于让人自己找；环通常 3 个节点以内，直接给出来。
 *
 * @param {{edges: Map<string,string[]>|object, from: string, target: string}} o
 * @returns {string[]|null}
 */
export function findCycle({ edges, from, target } = {}) {
  const adj = edges instanceof Map ? edges : new Map(Object.entries(edges ?? {}));
  const want = tok(target);
  const start = tok(from);
  if (!want || !start) return null;
  const seen = new Set();
  const path = [];
  const dfs = (node) => {
    if (seen.has(node)) return null; // 已探索过（或正在栈上）⇒ 不必再走
    seen.add(node);
    path.push(node);
    for (const nx of adj.get(node) ?? []) {
      const n = tok(nx);
      if (!n) continue;
      if (n === want) {
        path.push(n);
        // 闭合环：把起点补在末尾，读起来才是「A → B → C → A」而不是断在 C
        if (start !== want) path.push(start);
        return path.slice();
      }
      const hit = dfs(n);
      if (hit) return hit;
    }
    path.pop();
    return null;
  };
  return dfs(start);
}

/**
 * 环路径 → 人读串：`A → B → C → A`
 * @param {string[]} path
 * @returns {string}
 */
export function formatCycle(path) {
  return (Array.isArray(path) ? path : []).map((x) => tok(x)).filter(Boolean).join(" → ");
}

/**
 * **统一邻接视图**（读面 / 前端唯一入口）。
 *
 * 给三样东西，全部现算、不落账：
 *   · `edges`       正向邻接（我依赖谁）
 *   · `dependents`  反向邻接（谁依赖我）—— 派生，不是第二份账
 *   · `depthOf`     链长「还要等几层」（按**节点数**算；今天没有工期数据，按节点数是唯一诚实口径）
 *
 * `depthOf` 的口径：`deps` 为空 ⇒ 0（不用等）；否则 = `1 + max(前置的 depth)`。
 *   只统计**未满足**的前置（`isDone(id)` 为真 ⇒ 该前置不再产生等待）。
 *   防环：已访问集合兜底，环里返回 0 而不是栈溢出（图本应无环，但读面不许崩）。
 *
 * @param {Array<object>} entries
 * @param {{idOf?: Function, depsOf?: Function, isDone?: (id:string)=>boolean}} [opts]
 */
export function buildDepGraph(entries, { idOf = (e) => e?.id, depsOf = (e) => e?.depends_on, isDone = () => false } = {}) {
  const edges = depEdges(entries, { idOf, depsOf });
  const dependents = new Map();
  for (const [id, deps] of edges) {
    for (const d of deps) {
      if (!dependents.has(d)) dependents.set(d, []);
      dependents.get(d).push(id);
    }
  }
  const memo = new Map();
  const depth1 = (id, seen) => {
    if (memo.has(id)) return memo.get(id);
    if (seen.has(id)) return 0; // 环兜底：不崩、不无限递归
    seen.add(id);
    const pending = (edges.get(id) ?? []).filter((d) => !isDone(d));
    const v = pending.length === 0 ? 0 : 1 + Math.max(...pending.map((d) => depth1(d, seen)));
    seen.delete(id);
    memo.set(id, v);
    return v;
  };
  const depthOf = (id) => depth1(tok(id), new Set());
  return { edges, dependents, depthOf };
}

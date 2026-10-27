/**
 * `scripts/lib/req-context.mjs` — **需求工单 · 上下文链接**（core 层）
 *
 * 0.42 · R-gm-42-0 · T-gm-42-0-01（设计稿 `docs/gd-req-order-design.md` §2.2）
 *
 * ## 是什么
 *
 * 一张工单要能回答「**该读什么**」。本模块管的就是那份结构化清单：
 * 需求条目上的 `context[]` —— 每条 `{ path|uri, kind, note, source, at }`。
 *
 * ## 三条硬约定
 *
 *   ① **链接必须是别人取得到的**（设计稿 §2.1 甲方案）：`kind` 只有三种 ——
 *      · `file` 仓内相对路径（席位 `seat sync` 后自己就有）
 *      · `uri`  外部链接（文档 / 设计稿 / issue）
 *      · `doc`  仓内文档 + 可选锚点（`docs/x.md#§2`）
 *      **不许放宿主本地绝对路径**（别的机器取不到）⇒ 绝对路径一律拒。
 *   ② **AI 只能建议**：`source: "ai-suggested"` 的条目落**草稿区**，owner 确认才进账
 *      （本模块只负责「写账」这一步；草稿区在 `lib/ai/*`，见 T-gm-42-0-03）。
 *   ③ **去重按 `kind + path|uri`**：同一条链接重复 add ⇒ 幂等（不写第二份）。
 *
 * 本模块**零第三方依赖**、只做数据规整与判据 ⇒ 可单测。
 */

import { unquoteScalar } from "./yaml.mjs"; // 读侧去引号（与写侧 scalarText 成对）

/** 允许的链接形态（`kind` 只有这三种） */
export const CONTEXT_KINDS = Object.freeze(["file", "uri", "doc"]);

/** 允许的来源（谁加的） */
export const CONTEXT_SOURCES = Object.freeze(["owner", "ai-suggested", "task"]);

/** 工单上下文最多几条（防「把所有文件都塞进来」——那就等于没有上下文） */
export const MAX_CONTEXT_ITEMS = 50;

/** 绝对路径判据（Windows `C:\…` / UNC `\\…` / POSIX `/…`） */
function looksAbsolute(p) {
  const s = String(p ?? "");
  return /^[A-Za-z]:[\\/]/.test(s) || s.startsWith("\\\\") || s.startsWith("/");
}

/**
 * 规整一条上下文链接（**永不抛**；不合法 ⇒ `{ok:false, code, error}`）。
 *
 * @param {object} input `{path|uri, kind, note, source, at}`
 * @returns {{ok:true, item:object} | {ok:false, code:string, error:string}}
 */
export function normalizeContextItem({ path = null, uri = null, kind = null, note = "", source = "owner", at = null } = {}) {
  const raw = String(path ?? uri ?? "").trim();
  if (!raw) return { ok: false, code: "E_CTX_EMPTY", error: "缺链接（给 path（仓内相对路径）或 uri（外部链接））" };

  // kind 缺省按形态猜：有 scheme 的当 uri，其余当 file（`#` 结尾的当 doc）
  let k = String(kind ?? "").trim().toLowerCase();
  if (!k) {
    k = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? "uri" : raw.includes("#") ? "doc" : "file";
  }
  if (!CONTEXT_KINDS.includes(k)) {
    return { ok: false, code: "E_CTX_KIND", error: `kind 非法："${k}"（可用：${CONTEXT_KINDS.join(" / ")}）` };
  }

  // ① 别的机器取不到的东西一律拒（设计稿 §2.1 甲方案推出的硬约束）
  if (k !== "uri" && looksAbsolute(raw)) {
    return {
      ok: false,
      code: "E_CTX_ABSOLUTE",
      error: `不许放绝对路径（${raw}）—— 别的席位/机器取不到；改成仓内相对路径（如 docs/x.md）`,
    };
  }
  if (k === "uri" && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    return { ok: false, code: "E_CTX_URI", error: `kind=uri 但不像链接（${raw}）—— 要 http(s)://… 这种` };
  }

  const src = String(source ?? "owner").trim().toLowerCase();
  const source2 = CONTEXT_SOURCES.includes(src) ? src : "owner";
  return {
    ok: true,
    item: {
      kind: k,
      path: k === "uri" ? null : raw.replace(/\\/g, "/"),
      uri: k === "uri" ? raw : null,
      note: String(note ?? "").trim(),
      source: source2,
      at: at ? String(at) : new Date().toISOString(),
    },
  };
}

/**
 * 规整整份清单（脏数据丢弃、去重、限条数）。
 * @param {any} raw 账上的 `context`
 * @returns {object[]}
 */
export function normalizeContextList(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const raw2 = String(item.path ?? item.uri ?? "").trim();
    if (!raw2) continue;
    const k = String(item.kind ?? "").trim().toLowerCase();
    const kind = CONTEXT_KINDS.includes(k) ? k : /^[a-z][a-z0-9+.-]*:\/\//i.test(raw2) ? "uri" : "file";
    const key = `${kind}|${raw2}`;
    if (seen.has(key)) continue; // 去重（kind + 目标）
    seen.add(key);
    out.push({
      kind,
      path: kind === "uri" ? null : unquoteScalar(String(item.path ?? raw2)).replace(/\\/g, "/"),
      uri: kind === "uri" ? unquoteScalar(String(item.uri ?? raw2)) : null,
      note: unquoteScalar(String(item.note ?? "")),
      source: CONTEXT_SOURCES.includes(String(item.source ?? "").toLowerCase()) ? String(item.source).toLowerCase() : "owner",
      at: item.at ? String(item.at) : null,
    });
    if (out.length >= MAX_CONTEXT_ITEMS) break;
  }
  return out;
}

/** 一条链接的**唯一键**（去重 / 删除用：`kind|目标`） */
export function contextKey(item) {
  const k = String(item?.kind ?? "").trim();
  const t = String(item?.path ?? item?.uri ?? "").trim().replace(/\\/g, "/");
  return `${k}|${t}`;
}

/**
 * 加一条（幂等：同一 `kind|目标` 已存在 ⇒ `added:false`，不写第二份）。
 * @param {object[]} list 现有清单
 * @param {object} input  `normalizeContextItem` 的入参
 * @returns {{ok:true, list:object[], added:boolean} | {ok:false, code:string, error:string}}
 */
export function addContextItem(list, input) {
  const n = normalizeContextItem(input);
  if (!n.ok) return n;
  const cur = normalizeContextList(list);
  const key = contextKey(n.item);
  if (cur.some((x) => contextKey(x) === key)) return { ok: true, list: cur, added: false };
  if (cur.length >= MAX_CONTEXT_ITEMS) {
    return { ok: false, code: "E_CTX_FULL", error: `上下文最多 ${MAX_CONTEXT_ITEMS} 条（再多就等于没有上下文）——先删几条` };
  }
  return { ok: true, list: [...cur, n.item], added: true };
}

/**
 * 删一条（按 `kind|目标` 匹配）。
 * @returns {{ok:true, list:object[], removed:boolean}}
 */
export function removeContextItem(list, { path = null, uri = null, kind = null } = {}) {
  const cur = normalizeContextList(list);
  const target = String(path ?? uri ?? "").trim().replace(/\\/g, "/");
  if (!target) return { ok: true, list: cur, removed: false };
  const k = String(kind ?? "").trim().toLowerCase();
  const next = cur.filter((x) => !((!k || x.kind === k) && String(x.path ?? x.uri ?? "") === target));
  return { ok: true, list: next, removed: next.length !== cur.length };
}

/**
 * 给**席位 / AI** 看的人话摘要（一行一条；空清单 ⇒ 明确说「未填」而不是留白）。
 * @param {object[]} list
 * @returns {string[]}
 */
export function renderContext(list) {
  const cur = normalizeContextList(list);
  if (!cur.length) return ["（工单未填上下文链接——不知道该读哪些文件时，先问需求归属人）"];
  return cur.map((x) => {
    const t = x.kind === "uri" ? x.uri : x.path;
    const note = x.note ? ` —— ${x.note}` : "";
    const src = x.source === "ai-suggested" ? "（AI 建议）" : "";
    return `- [${x.kind}] ${t}${note}${src}`;
  });
}

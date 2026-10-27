/**
 * capability-ledger —— 能力层账读写（m-6 · capability-layer · core 层）
 *
 * 定位（详设 docs/gd-capability-layer-design.md §1–§2）：
 *   能力 = 板上一类可复用产出的**契约面**：身份 + 目的 + 判据（可判定的行为）+ 载体（物理落点）。
 *   能力条目是**板上一等实体**，与需求同构：目录条目 + 自有正文文件 + 事件流。
 *
 * 板账布局（core 层 · 板根即账根）：
 *   <板根>/capabilities/index.yaml        能力目录（条目全集 · 不装判据正文）
 *   <板根>/capabilities/<cap-id>/spec.yaml  判据正文（**事实源**）
 *   <板根>/capabilities/<cap-id>/events.jsonl 能力级事件流（判据增删改 = 合并历史 · 只追加）
 *
 * 边界：
 *   · **core 内零 import app**（机器守卫 scripts/core-layer-guard.mjs）——本模块只依赖板账与 yaml 解析。
 *   · **载体指针只存不解析**：`kind` 是开放枚举（file / doc / uri …），新 kind 由 gd-agent 层注册进来；
 *     本模块不认具体 kind 的语义，也不解析跨仓指针（第三步）。
 *   · **判据两态**（committed / fulfilled）的流转在 0.62 落地；本模块只承载字段与读写。
 *   · **改判据不静默覆盖**：正文变更经 appendCapEvents 留 before/after（0.63 的 merge 用）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseYaml, unquoteScalar } from "./yaml.mjs";
import { appendEvents, listReqIds, nowIso, readReqEntries, readReqIndexBlock, readTaskLedger, removeReqIndexBlock, upsertReqIndexBlock, writeFileAtomic, withBoardLock } from "./board.mjs";
import { applyDelta, normalizeBindings, readDelta } from "./capability-delta.mjs";

/** 能力目录名（板根下的相对目录） */
export const CAPABILITIES_DIR = "capabilities";

/** 能力 id 形态：kebab-case（首段字母，其余小写字母数字与连字符） */
export const CAP_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * 能力条目的**字段白名单**（0.68 起）。
 *
 * 为什么要有它：0.61 给条目加过一个 `domain` 字段（闭枚举 reqs/agents/seats/shared），事后查明
 *   它是**把 gdMain 本仓的域化架构硬编码进了账的契约** —— gm 板上 5 项同值（零区分度），
 *   下游项目板则被强制用本仓词汇。全仓零机制消费它 ⇒ 0.68 退役。
 *   分类信息本来就在能力 id 里（`req-intake` / `seat-deliver` / `contract-gate` 一眼可辨），
 *   读面用 `--prefix` 筛即可，不必多记一份假分类。
 *
 * 白名单的第二个作用（C8-11）：**防止将来再往条目里塞没人读的字段** ——
 *   「加一个字段」比「维护一个假字段」贵得多，所以加字段要先过这道闸。
 */
export const CAP_ENTRY_FIELDS = ["id", "title", "purpose", "status", "created", "revision", "requirements_count", "carriers"];

/** 能力条目状态（只有两态：active / retired；无 deleted、无 paused —— 详设 §3.1 / §11） */
export const CAP_STATUSES = ["active", "retired"];

/** 载体指针 kind（**开放枚举**：core 只存不解析；新 kind 由 gd-agent 层注册） */
export const CAP_CARRIER_KINDS = ["file", "doc", "uri"];

// ── 路径 ─────────────────────────────────────────────────────

export function capIndexPath(projDir) {
  return join(projDir, CAPABILITIES_DIR, "index.yaml");
}

export function capDirOf(projDir, capId) {
  return join(projDir, CAPABILITIES_DIR, capId);
}

export function capSpecPath(projDir, capId) {
  return join(capDirOf(projDir, capId), "spec.yaml");
}

export function capEventsPath(projDir, capId) {
  return join(capDirOf(projDir, capId), "events.jsonl");
}

// ── YAML 输出（自写小发射器：能力层两个文件形状由本模块独占，写法单一事实源）──────────

/** 单行标量：需要时加双引号（含 `: ` / `#` / 首尾空白 / 形似数字或布尔 / 空串） */
function yScalar(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  if (s === "") return '""';
  if (/[\n]/.test(s)) return JSON.stringify(s);
  // 需引号的情形只有这几类：首尾空白 · 以引号/井号开头 · 含 `: ` 或 ` #` · 空串 · 形似数字/布尔/空值
  if (/^\s|\s$|^[\s"'#]|:\s| #/.test(s) || /^(true|false|null|~|yes|no|on|off)$/i.test(s) || /^-?\d+(\.\d+)?$/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

/** 值渲染：标量 / 数组 / 对象（两层缩进；数组元素 `- ` 起头） */
function yValue(v, indent) {
  const pad = " ".repeat(indent);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    const out = [];
    for (const item of v) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const keys = Object.keys(item);
        if (keys.length === 0) {
          out.push(`${pad}- {}`);
          continue;
        }
        const first = keys[0];
        out.push(`${pad}- ${first}: ${yValue(item[first], indent + 4)}`);
        for (const k of keys.slice(1)) out.push(`${pad}  ${k}: ${yValue(item[k], indent + 4)}`);
      } else {
        out.push(`${pad}- ${yValue(item, indent + 2)}`);
      }
    }
    return `\n${out.join("\n")}`;
  }
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 0) return "{}";
    const out = [];
    for (const k of keys) {
      const val = v[k];
      if (val === undefined) continue;
      if (val && typeof val === "object" && (Array.isArray(val) ? val.length > 0 : Object.keys(val).length > 0)) {
        out.push(`${pad}${k}:${yValue(val, indent + 2)}`);
      } else {
        out.push(`${pad}${k}: ${yValue(val, indent + 2)}`);
      }
    }
    return `\n${out.join("\n")}`;
  }
  return yScalar(v);
}

// ── 目录条目 ───────────────────────────────────────────────────

/** 读能力目录（缺文件 ⇒ 空目录；不抛） */
export function readCapIndex(projDir) {
  const p = capIndexPath(projDir);
  if (!existsSync(p)) return { capabilities: [] };
  let doc;
  try {
    doc = parseYaml(readFileSync(p, "utf8")) || {};
  } catch (e) {
    throw new Error(`能力目录解析失败（${p}）：${e.message}`);
  }
  const list = Array.isArray(doc.capabilities) ? doc.capabilities : [];
  // 数字字段归一（防引号累积）：本仓 YAML 解析器不剥引号 ⇒ 曾写成 `"2"` 的条目读出来是字符串，
  //   C8-10 拿 Number('"2"') = NaN 判成不一致（实测踩到）。读侧统一归一，写侧才不会积累脏值。
  return {
    capabilities: list.map((c) => ({
      ...c,
      revision: numOf(c?.revision, 1),
      requirements_count: numOf(c?.requirements_count, 0),
    })),
  };
}

/** 写能力目录（保字段写回：条目里的未知键逐字保留，只改已知键） */
export function writeCapIndex(projDir, capabilities) {
  const p = capIndexPath(projDir);
  mkdirSync(dirname(p), { recursive: true });
  const head = [
    "# 能力索引（Capabilities Index）—— 板级事实源（m-6 能力层 · 亲做）",
    "# 条目 = 能力的身份与目录（判据正文在 <cap-id>/spec.yaml · 事件流在 <cap-id>/events.jsonl）",
    "# 口径见 entry/workflow/reqflow.md §5.0.3 · 详设 docs/gd-capability-layer-design.md",
  ];
  const lines = [...head, ...String(yValue({ capabilities }, 0)).replace(/^\n/, "").split("\n").map((l) => l.replace(/\s+$/, ""))];
  writeFileSync(p, `${lines.join("\n")}\n`, "utf8");
  return p;
}

/** 能力条目（目录里的一项） */
export function findCapEntry(capabilities, capId) {
  return (capabilities ?? []).find((c) => String(c?.id ?? "") === String(capId)) ?? null;
}

/** 能力 id 校验（返回错误说明，合法 ⇒ null） */
export function capIdProblem(capId) {
  const id = String(capId ?? "").trim();
  if (!id) return "能力 id 不能为空";
  if (!CAP_ID_RE.test(id)) return `能力 id 需为 kebab-case（首段字母，其余小写字母数字与连字符）：现值 "${id}"`;
  return null;
}

/** 载体指针校验（只校验形状与硬约束，不解析目标是否存在——那是读面的事） */
export function carrierProblem(carrier) {
  if (!carrier || typeof carrier !== "object") return "载体指针必须是对象";
  const kind = String(carrier.kind ?? "").trim();
  if (!kind) return "载体指针缺 kind";
  const loc = String(carrier.path ?? carrier.uri ?? "").trim();
  if (!loc) return `载体指针缺定位（path / uri）`;
  if (kind !== "uri" && /^[A-Za-z]:[\\/]/.test(loc)) return `载体指针不许绝对路径：${loc}`;
  if (kind !== "uri" && loc.startsWith("/")) return `载体指针不许绝对路径：${loc}`;
  if (kind === "uri" && !/^[a-z][a-z0-9+.-]*:\/\//i.test(loc)) return `uri 载体需带 scheme：${loc}`;
  return null;
}

/**
 * 判据列表归一：本仓 YAML 解析器**不剥首尾引号**（`lib/yaml.mjs: unquoteScalar` 是消费方归一用的），
 *   所以读出来一律过一遍 —— 否则「写进去带引号、读出来还带引号、再写又转义一层」
 *   会把场景名与 MUST 逐步污染成 `"\\"缺 ver\\""` 这种鬼东西。
 */
function normalizeReqList(list) {
  return list.map((r) => ({
    ...r,
    id: unquoteScalar(String(r?.id ?? "")),
    title: unquoteScalar(String(r?.title ?? "")),
    must: unquoteScalar(String(r?.must ?? "")),
    state: normalizeReqState(unquoteScalar(String(r?.state ?? ""))),
    committed_by: unquoteScalar(String(r?.committed_by ?? "")),
    fulfilled_at: normTimeOf(r),
    evidence: (r?.evidence ?? []).map((e) => unquoteScalar(String(e))).filter((e) => e !== ""),
    scenarios: (r?.scenarios ?? []).map((sc) => ({
      id: unquoteScalar(String(sc?.id ?? "")),
      name: unquoteScalar(String(sc?.name ?? "")),
      when: unquoteScalar(String(sc?.when ?? "")),
      then: unquoteScalar(String(sc?.then ?? "")),
    })),
  }));
}

// ── 判据正文 ───────────────────────────────────────────────────

/** 读判据正文（缺文件 ⇒ 空骨架） */
export function readCapSpec(projDir, capId) {
  const p = capSpecPath(projDir, capId);
  if (!existsSync(p)) return { capability: capId, revision: 1, requirements: [] };
  let doc;
  try {
    doc = parseYaml(readFileSync(p, "utf8")) || {};
  } catch (e) {
    throw new Error(`能力判据正文解析失败（${p}）：${e.message}`);
  }
  return {
    capability: unquoteScalar(String(doc.capability ?? capId)) || capId,
    revision: Number(unquoteScalar(String(doc.revision ?? 1))) || 1,
    requirements: normalizeReqList(Array.isArray(doc.requirements) ? doc.requirements : []),
  };
}

/** 写判据正文 */
export function writeCapSpec(projDir, capId, spec) {
  const p = capSpecPath(projDir, capId);
  mkdirSync(dirname(p), { recursive: true });
  const head = [
    `# 能力判据正文 —— ${capId}（事实源 · Markdown 视图由 gd cap export 产出）`,
    "# 一条判据 = 一句 MUST + 至少一个场景；state: committed | fulfilled（两态 · 详设 §3.2）",
  ];
  // 写面按白名单净化：判据与场景只写 CAP_REQ_FIELDS / CAP_SCEN_FIELDS 里的键 ——
  //   退役字段（如 activated_at）在一次写入后就自然消失，不需要单独的迁移脚本
  const clean = (spec?.requirements ?? []).map((r) => {
    const o = {};
    for (const k of CAP_REQ_FIELDS) {
      if (k === "scenarios") o.scenarios = (r?.scenarios ?? []).map((sc) => {
        const so = {};
        for (const sk of CAP_SCEN_FIELDS) if (sc?.[sk] !== undefined) so[sk] = sc[sk];
        return so;
      });
      else if (k === "state") o.state = normalizeReqState(r?.state ?? "committed");
      else if (k === "fulfilled_at") o.fulfilled_at = normTimeOf(r);
      else if (r?.[k] !== undefined) o[k] = r[k];
    }
    return o;
  });
  const body = { capability: capId, revision: spec?.revision ?? 1, requirements: clean };
  const lines = [...head, ...String(yValue(body, 0)).replace(/^\n/, "").split("\n").map((l) => l.replace(/\s+$/, ""))];
  writeFileAtomic(p, `${lines.join("\n")}\n`, {});
  return p;
}

// ── 事件流（能力级 · 只追加 · = 合并历史）──────────────────────────

/** 读事件 */
export function readCapEvents(projDir, capId) {
  const p = capEventsPath(projDir, capId);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** 追加事件（seq 在文件内自增） */
export function appendCapEvents(projDir, capId, entries) {
  const rows = [];
  let seq = readCapEvents(projDir, capId).length;
  for (const e of entries ?? []) {
    if (!e) continue;
    rows.push({ seq: seq++, at: e.at ?? nowIso(), by: e.by ?? "", ...e });
  }
  if (rows.length === 0) return [];
  const p = capEventsPath(projDir, capId);
  mkdirSync(dirname(p), { recursive: true });
  const prev = existsSync(p) ? readFileSync(p, "utf8") : "";
  writeFileSync(p, `${prev}${rows.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
  return rows;
}

// ── 写面（建能力 / 改能力）────────────────────────────────────────

/**
 * 立一项能力（A3：条目先立，判据可空 = 未承诺，不阻塞）。
 * @param {{projDir: string, capId: string, title: string, purpose?: string,
 *          carriers?: object[], status?: string, by?: string}} o
 * @returns {{ok: true, capId: string, created: string} | {ok: false, error: string}}
 */
export function createCapability({ projDir, capId, title, purpose = "", carriers = [], status = "active", by = "" }) {
  const idProblem = capIdProblem(capId);
  if (idProblem) return { ok: false, error: idProblem };
  if (!String(title ?? "").trim()) return { ok: false, error: "能力标题不能为空" };
  if (!CAP_STATUSES.includes(String(status))) return { ok: false, error: `status 需为 ${CAP_STATUSES.join(" / ")} 之一：现值 "${status}"` };
  for (const c of carriers ?? []) {
    const p = carrierProblem(c);
    if (p) return { ok: false, error: p };
  }

  return withBoardLock(projDir, () => {
    const idx = readCapIndex(projDir);
    if (findCapEntry(idx.capabilities, capId)) return { ok: false, error: `能力 ${capId} 已存在` };
    if (existsSync(capDirOf(projDir, capId))) return { ok: false, error: `能力目录已存在：${capId}（账与目录不一致，请手工核对）` };

    const created = nowIso().slice(0, 10);
    const entry = {
      id: capId,
      title: String(title).trim(),
      ...(String(purpose ?? "").trim() ? { purpose: String(purpose).trim() } : {}), // 空值不落盘（同需求条目「空即未填」口径）
      status: String(status),
      created,
      revision: 1,
      requirements_count: 0,
      carriers: (carriers ?? []).map(normalizeCarrier),
    };
    idx.capabilities = [...idx.capabilities, entry];
    mkdirSync(capDirOf(projDir, capId), { recursive: true });
    writeCapSpec(projDir, capId, { capability: capId, revision: 1, requirements: [] });
    writeCapIndex(projDir, idx.capabilities);
    appendCapEvents(projDir, capId, [{ state: "created", by, title: entry.title }]);
    return { ok: true, capId, created };
  });
}

/**
 * 改能力条目（保字段写回：只改显式给出的字段）。
 * @param {{projDir: string, capId: string, patch: object, by?: string}} o
 */
export function updateCapability({ projDir, capId, patch = {}, by = "" }) {
  return withBoardLock(projDir, () => {
    const idx = readCapIndex(projDir);
    const entry = findCapEntry(idx.capabilities, capId);
    if (!entry) return { ok: false, error: `能力 ${capId} 不在目录里（gd cap list 查看）` };
    if (entry.status === "retired" && Object.keys(patch).length > 0) {
      return { ok: false, error: `能力 ${capId} 已退役（只读）` };
    }
    const before = { ...entry };
    if (patch.title !== undefined) entry.title = String(patch.title).trim();
    if (patch.purpose !== undefined) entry.purpose = String(patch.purpose).trim();
    if (patch.status !== undefined) {
      if (!CAP_STATUSES.includes(String(patch.status))) return { ok: false, error: `status 需为 ${CAP_STATUSES.join(" / ")} 之一` };
      entry.status = String(patch.status);
    }
    if (patch.carriers !== undefined) {
      for (const c of patch.carriers) {
        const p = carrierProblem(c);
        if (p) return { ok: false, error: p };
      }
      entry.carriers = patch.carriers.map(normalizeCarrier);
    }
    const spec = readCapSpec(projDir, capId);
    entry.requirements_count = spec.requirements.length;
    writeCapIndex(projDir, idx.capabilities);
    appendCapEvents(projDir, capId, [{ state: "updated", by, before: { title: before.title, purpose: before.purpose, status: before.status }, after: { title: entry.title, purpose: entry.purpose, status: entry.status } }]);
    return { ok: true, capId, entry };
  });
}

/** 载体指针归一（只保留已知键；kind/path/uri/anchor） */
export function normalizeCarrier(c) {
  const out = { kind: String(c?.kind ?? "").trim() };
  if (c?.path !== undefined) out.path = String(c.path).trim();
  if (c?.uri !== undefined) out.uri = String(c.uri).trim();
  if (c?.anchor !== undefined) out.anchor = String(c.anchor).trim();
  return out;
}

/** 解析 "kind:定位" 形式的载体指针（锚点用 # 挂在 path 后） */
export function parseCarrierSpec(raw) {
  const s = String(raw ?? "").trim();
  const i = s.indexOf(":");
  if (i < 0) return { ok: false, error: `载体指针格式应为 "kind:定位"（收到 "${s}"）` };
  const kind = s.slice(0, i).trim();
  let loc = s.slice(i + 1).trim();
  if (!kind) return { ok: false, error: `载体指针缺 kind（收到 "${s}"）` };
  if (!loc) return { ok: false, error: `载体指针缺定位（收到 "${s}"）` };
  const out = { kind };
  if (kind === "uri") {
    out.uri = loc;
  } else {
    const hash = loc.indexOf("#");
    if (hash >= 0) {
      out.path = loc.slice(0, hash);
      out.anchor = loc.slice(hash + 1);
    } else {
      out.path = loc;
    }
  }
  const p = carrierProblem(out);
  if (p) return { ok: false, error: p };
  return { ok: true, carrier: out };
}

// ── 判据写面（0.62：手工写面 · delta 驱动归 0.63）───────────────────

/** 判据编号形态：`R<n>`（能力内稳定，不复用已删号） */
export const CAP_REQ_ID_RE = /^R[1-9][0-9]*$/;
/** 场景编号形态：`S<n>`（判据内唯一） */
export const CAP_SCEN_ID_RE = /^S[1-9][0-9]*$/;
/**
 * 判据两态：`committed`（承诺）→ `fulfilled`（兑现）。
 *
 * 为什么是 fulfilled 而不是 activated：能力条目的 `status` 用 `active / retired`，
 *   而 `activated` 与之形近却是**判据级**的概念 —— 两个层级的词撞车，人和 AI 每次都要多问一句
 *   「这个 active 是哪层的」（实测被用户点名过一次）。改名代价远低于长期歧义（R-gm-68-1）。
 */
export const CAP_REQ_STATES = ["committed", "fulfilled"];

/** 判据字段白名单（与 CAP_ENTRY_FIELDS 同族）：写面只写这些键 —— 退役字段名不会再被写回 */
export const CAP_REQ_FIELDS = ["id", "title", "must", "state", "committed_by", "fulfilled_at", "evidence", "scenarios"];

/** 场景字段白名单 */
export const CAP_SCEN_FIELDS = ["id", "name", "when", "then"];

/** 旧名（只读兼容：历史账与历史事件里的 activated 仍按「兑现」理解，但不再写回） */
export const CAP_REQ_STATE_ALIASES = { activated: "fulfilled" };

/** 判据兑现时刻（新名 fulfilled_at；旧账里的 activated_at 只读兼容，不写回） */
function normTimeOf(r) {
  const v = r?.fulfilled_at ?? r?.activated_at ?? null;
  return v ? unquoteScalar(String(v)) : null;
}

/** 把判据状态归一成当前值（`activated` ⇒ `fulfilled`；未知值原样返回给校验去报） */
export function normalizeReqState(v) {
  const s = String(v ?? "").trim();
  return CAP_REQ_STATE_ALIASES[s] ?? s;
}

/**
 * 分配下一个判据号：取**历史最大值 + 1**（不是「现存最大 + 1」）。
 *
 * 为什么看历史：删掉的 `R3` 若被复用，指向 `R3` 的缺陷单会突然开始指到另一条判据上
 *   —— 挂点静默错位比号段不连续严重得多（详设 §11 待决 4 的默认取向）。
 * @param {{requirements: object[], history?: object[]}} o
 */
export function nextReqNo({ requirements = [], history = [] } = {}) {
  const nums = [];
  for (const r of requirements) {
    const m = String(r?.id ?? "").match(/^R(\d+)$/);
    if (m) nums.push(Number(m[1]));
  }
  for (const ev of history) {
    for (const key of ["added", "removed"]) {
      for (const id of ev?.[key] ?? []) {
        const m = String(id).match(/^R(\d+)$/);
        if (m) nums.push(Number(m[1]));
      }
    }
    for (const m2 of ev?.modified ?? []) {
      const m = String(m2?.id ?? "").match(/^R(\d+)$/);
      if (m) nums.push(Number(m[1]));
    }
  }
  return `R${nums.length === 0 ? 1 : Math.max(...nums) + 1}`;
}

/** 判据形状校验（返回问题清单，空数组 = 合规） */
export function requirementProblems(req) {
  const probs = [];
  const id = String(req?.id ?? "").trim();
  if (!CAP_REQ_ID_RE.test(id)) probs.push(`判据 id 形态非法（应为 R<n> · 现值 "${id}"）`);
  if (!String(req?.title ?? "").trim()) probs.push(`判据 ${id}：缺 title`);
  if (!String(req?.must ?? "").trim()) probs.push(`判据 ${id}：缺 must（一句 MUST）`);
  const state = normalizeReqState(req?.state);
  if (!CAP_REQ_STATES.includes(state)) {
    probs.push(`判据 ${id}：state 非法（现值 "${req?.state ?? ""}"，应 ∈ ${CAP_REQ_STATES.join(" / ")}）`);
  }
  const scen = Array.isArray(req?.scenarios) ? req.scenarios : [];
  if (scen.length === 0) probs.push(`判据 ${id}：至少需要一个场景（没有场景的判据不可验证）`);
  const seen = new Set();
  for (const s of scen) {
    const sid = String(s?.id ?? "").trim();
    if (!CAP_SCEN_ID_RE.test(sid)) probs.push(`判据 ${id}：场景 id 形态非法（应为 S<n> · 现值 "${sid}"）`);
    if (sid) {
      if (seen.has(sid)) probs.push(`判据 ${id}：场景 id 重复 ${sid}`);
      seen.add(sid);
    }
    if (!String(s?.when ?? "").trim()) probs.push(`判据 ${id} / 场景 ${sid}：缺 when`);
    if (!String(s?.then ?? "").trim()) probs.push(`判据 ${id} / 场景 ${sid}：缺 then`);
  }
  if (state === "fulfilled") {
    if (!String(req?.fulfilled_at ?? "").trim()) probs.push(`判据 ${id}：state=fulfilled 但缺 fulfilled_at`);
    if (!String(req?.committed_by ?? "").trim()) probs.push(`判据 ${id}：state=fulfilled 但缺 committed_by`);
    if ((req?.evidence ?? []).filter((e) => String(e ?? "").trim()).length === 0) {
      probs.push(`判据 ${id}：state=fulfilled 但缺 evidence（兑现要有证据）`);
    }
  }
  return probs;
}

/** 解析 `--scenario "名称|WHEN|THEN"` */
export function parseScenarioSpec(raw, idx) {
  const s = String(raw ?? "").trim();
  const parts = s.split("|").map((x) => x.trim());
  if (parts.length !== 3) return { ok: false, error: `--scenario 格式应为 "名称|WHEN|THEN"（收到 "${s}"）` };
  const [name, when, then] = parts;
  if (!name) return { ok: false, error: `--scenario 缺名称（收到 "${s}"）` };
  if (!when) return { ok: false, error: `--scenario "${name}" 缺 WHEN` };
  if (!then) return { ok: false, error: `--scenario "${name}" 缺 THEN` };
  return { ok: true, scenario: { id: `S${idx}`, name, when, then } };
}

/**
 * 加一条判据（0.62 手工写面）。
 *
 * 判据正文变了 ⇒ 能力 `revision` +1，且改动进能力级事件流（before/after）——**不静默覆盖**。
 */
export function addRequirement({ projDir, capId, title, must, scenarios = [], committedBy = "", by = "" }) {
  return withBoardLock(projDir, () => {
    const idx = readCapIndex(projDir);
    const entry = findCapEntry(idx.capabilities, capId);
    if (!entry) return { ok: false, error: `能力 ${capId} 不在目录里（gd cap list 查看）` };
    if (entry.status === "retired") return { ok: false, error: `能力 ${capId} 已退役（只读）：判据不再接受新增` };
    const spec = readCapSpec(projDir, capId);
    const id = nextReqNo({ requirements: spec.requirements, history: readCapEvents(projDir, capId) });
    const req = {
      id,
      title: String(title ?? "").trim(),
      must: String(must ?? "").trim(),
      state: "committed",
      committed_by: String(committedBy ?? "").trim(),
      fulfilled_at: null,
      scenarios: scenarios.map((s, i) => ({ id: s.id ?? `S${i + 1}`, name: s.name ?? "", when: s.when ?? "", then: s.then ?? "" })),
    };
    const probs = requirementProblems({ ...req, fulfilled_at: null });
    if (probs.length > 0) return { ok: false, error: probs.join("；") };
    const next = { ...spec, revision: (Number(spec.revision ?? 1) || 1) + 1, requirements: [...spec.requirements, req] };
    writeCapSpec(projDir, capId, next);
    syncCapEntryDerived(projDir, idx, entry, next);
    appendCapEvents(projDir, capId, [{ state: "req-added", by, req: committedBy || null, added: [id] }]);
    return { ok: true, capId, requirement: req, revision: next.revision };
  });
}

/** 改一条判据（只改显式给出的字段；正文变了 ⇒ state 回 committed） */
export function updateRequirement({ projDir, capId, reqId, patch = {}, by = "" }) {
  return withBoardLock(projDir, () => {
    const idx = readCapIndex(projDir);
    const entry = findCapEntry(idx.capabilities, capId);
    if (!entry) return { ok: false, error: `能力 ${capId} 不在目录里` };
    if (entry.status === "retired") return { ok: false, error: `能力 ${capId} 已退役（只读）` };
    const spec = readCapSpec(projDir, capId);
    const at = spec.requirements.findIndex((r) => String(r?.id) === String(reqId));
    if (at < 0) return { ok: false, error: `能力 ${capId} 没有判据 ${reqId}（gd cap show ${capId} 查看）` };
    const before = { ...spec.requirements[at] };
    const cur = { ...before };
    if (patch.title !== undefined) cur.title = String(patch.title).trim();
    if (patch.must !== undefined) cur.must = String(patch.must).trim();
    if (patch.scenarios !== undefined) cur.scenarios = patch.scenarios;
    if (patch.committedBy !== undefined) cur.committed_by = String(patch.committedBy).trim();
    // 正文变了 = 新的承诺 ⇒ 已兑现的判据回 committed（要重新兑现才算数）
    const bodyChanged =
      String(cur.must) !== String(before.must) ||
      String(cur.title) !== String(before.title) ||
      JSON.stringify(cur.scenarios ?? []) !== JSON.stringify(before.scenarios ?? []);
    if (bodyChanged && normalizeReqState(before.state) === "fulfilled") {
      cur.state = "committed";
      cur.fulfilled_at = null;
      cur.evidence = [];
    }
    const probs = requirementProblems(cur);
    if (probs.length > 0) return { ok: false, error: probs.join("；") };
    const reqs = spec.requirements.slice();
    reqs[at] = cur;
    const next = { ...spec, revision: (Number(spec.revision ?? 1) || 1) + 1, requirements: reqs };
    writeCapSpec(projDir, capId, next);
    syncCapEntryDerived(projDir, idx, entry, next);
    appendCapEvents(projDir, capId, [{
      state: "req-updated", by,
      modified: [{ id: cur.id, before: { title: before.title, must: before.must, state: before.state }, after: { title: cur.title, must: cur.must, state: cur.state } }],
      ...(bodyChanged && normalizeReqState(before.state) === "fulfilled" ? { reopened: true } : {}),
    }]);
    return { ok: true, capId, requirement: cur, revision: next.revision, reopened: bodyChanged && normalizeReqState(before.state) === "fulfilled" };
  });
}

/** 删一条判据（删留痕；号不复用） */
export function removeRequirement({ projDir, capId, reqId, by = "" }) {
  return withBoardLock(projDir, () => {
    const idx = readCapIndex(projDir);
    const entry = findCapEntry(idx.capabilities, capId);
    if (!entry) return { ok: false, error: `能力 ${capId} 不在目录里` };
    if (entry.status === "retired") return { ok: false, error: `能力 ${capId} 已退役（只读）` };
    const spec = readCapSpec(projDir, capId);
    const hit = spec.requirements.find((r) => String(r?.id) === String(reqId));
    if (!hit) return { ok: false, error: `能力 ${capId} 没有判据 ${reqId}` };
    const next = { ...spec, revision: (Number(spec.revision ?? 1) || 1) + 1, requirements: spec.requirements.filter((r) => String(r?.id) !== String(reqId)) };
    writeCapSpec(projDir, capId, next);
    syncCapEntryDerived(projDir, idx, entry, next);
    appendCapEvents(projDir, capId, [{ state: "req-removed", by, removed: [String(reqId)], before: { title: hit.title, must: hit.must } }]);
    return { ok: true, capId, removed: String(reqId), revision: next.revision };
  });
}

/**
 * 判据兑现：committed → fulfilled（记时刻 + 证据）。
 *
 * 幂等：已 fulfilled 再调用 ⇒ 幂等成功（不改时刻）；缺证据 ⇒ 拒（兑现要有证据）。
 * @param {{projDir: string, capId: string, reqIds?: string[]|null, evidence?: string[], by?: string, at?: string|null}} o
 */
export function fulfillRequirements({ projDir, capId, reqIds = null, evidence = [], by = "", at = null, onlyCommittedBy = null }) {
  return withBoardLock(projDir, () => {
    const idx = readCapIndex(projDir);
    const entry = findCapEntry(idx.capabilities, capId);
    if (!entry) return { ok: false, error: `能力 ${capId} 不在目录里` };
    if (entry.status === "retired") return { ok: false, error: `能力 ${capId} 已退役（只读）` };
    const ev = (evidence ?? []).map((e) => String(e ?? "").trim()).filter(Boolean);
    if (ev.length === 0) return { ok: false, error: "兑现要有证据：给至少一条 --evidence（任务 id / 交付件路径 / 门禁结果）" };
    const spec = readCapSpec(projDir, capId);
    // 范围：显式 reqIds 优先；否则「所有未兑现」；给了 onlyCommittedBy 就只取该需求承诺的那几条
    const want =
      Array.isArray(reqIds) && reqIds.length > 0
        ? reqIds.map(String)
        : spec.requirements
            .filter((r) => normalizeReqState(r?.state) !== "fulfilled")
            .filter((r) => (onlyCommittedBy ? String(r?.committed_by ?? "") === String(onlyCommittedBy) : true))
            .map((r) => String(r.id));
    const missing = want.filter((id) => !spec.requirements.some((r) => String(r?.id) === id));
    if (missing.length > 0) return { ok: false, error: `能力 ${capId} 没有判据：${missing.join(" / ")}` };
    const already = want.filter(
      (id) => normalizeReqState(spec.requirements.find((r) => String(r.id) === id)?.state) === "fulfilled",
    );
    const todo = want.filter((id) => !already.includes(id));
    if (todo.length === 0) return { ok: true, capId, fulfilled: [], already, idempotent: true };
    const stamp = at ?? nowIso();
    const next = {
      ...spec,
      requirements: spec.requirements.map((r) =>
        todo.includes(String(r.id))
          ? { ...r, state: "fulfilled", fulfilled_at: stamp, evidence: [...(r.evidence ?? []).filter(Boolean), ...ev] }
          : r,
      ),
    };
    writeCapSpec(projDir, capId, next);
    syncCapEntryDerived(projDir, idx, entry, next);
    appendCapEvents(projDir, capId, [{ state: "fulfilled", by, requirements: todo, evidence: ev }]);
    return { ok: true, capId, fulfilled: todo, already };
  });
}

/** 派生态回写（判据条数 / 判据版本）——写判据之后必须同步，否则 C8-10 会红 */
function syncCapEntryDerived(projDir, idx, entry, spec) {
  entry.requirements_count = (spec.requirements ?? []).length;
  entry.revision = Number(spec.revision ?? 1) || 1;
  writeCapIndex(projDir, idx.capabilities);
}

// ── 需求侧挂点写面（0.63 · bind）────────────────────────────────

/**
 * 把需求挂到能力上（写需求条目 `capabilities[]`）。
 *
 * **保字段写回**：只替换这一个块，条目里 `versions:` / `context:` 等子树逐字保留
 *   （走 `lib/board.mjs: upsertReqIndexBlock`，与 `req context` / `req delivery` 同一条路）。
 *
 * @param {{projDir: string, reqId: string, bindings: object[], by?: string}} o
 */
export function writeReqBindings({ projDir, reqId, bindings, by = "" }) {
  const rows = [];
  for (const b of bindings) {
    rows.push(`- id: ${b.id}`);
    rows.push(`  role: ${b.role ?? "owner"}`);
    if (b.delta) rows.push(`  delta: ${b.delta}`);
  }
  const blockText = rows.join("\n");
  const changed = blockText
    ? upsertReqIndexBlock(projDir, reqId, "capabilities", blockText)
    : removeReqIndexBlock(projDir, reqId, "capabilities");
  if (changed) {
    appendEvents(projDir, reqId, [
      {
        kind: "note",
        actor: by || "local", // 需求级事件流的必填字段是 actor（不是 by）；缺了 normalizeEvent 直接抛
        text: `能力挂点更新：${bindings.map((b) => `${b.id}(${b.role ?? "owner"})`).join(" / ") || "（已清空）"}`,
      },
    ]);
  }
  return changed;
}

/** 读需求条目里的能力挂点（归一） */
export function readReqBindings(projDir, reqId) {
  const block = readReqIndexBlock(projDir, reqId, "capabilities");
  if (!block) return [];
  return normalizeBindings(blockToObjects(block));
}

/** 把 `- id: x / role: y` 形态的块文本解析成对象数组（只认这三个键，够用且不引第三方 YAML） */
function blockToObjects(text) {
  const out = [];
  let cur = null;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    const item = line.match(/^\s*-\s+([a-z_]+):\s*(.*)$/i);
    if (item) {
      cur = { [item[1]]: stripScalar(item[2]) };
      out.push(cur);
      continue;
    }
    const kv = line.match(/^\s+([a-z_]+):\s*(.*)$/i);
    if (kv && cur) cur[kv[1]] = stripScalar(kv[2]);
  }
  return out;
}

function stripScalar(v) {
  const s = String(v ?? "").trim();
  return s.startsWith('"') || s.startsWith("'") ? s.slice(1, -1) : s;
}

// ── 合入（merge · 0.63）──────────────────────────────────────────

/**
 * 合入一份 delta（板锁 + 事务语义在这一次调用里完成）。
 *
 * **幂等判据**：能力事件流里已有 `state: merged` 且 `req` 等于本需求 ⇒ 视为已合入。
 * **冲突判据**：同一能力上「别的需求挂点、且它还没合入」的 delta 触及了同样的判据标题。
 *
 * @param {{projDir: string, capId: string, reqId: string, deltaPath: string, by?: string, dryRun?: boolean}} o
 * @returns {{ok: true, result: object, revision: number, idempotent?: boolean} | {ok: false, error: string}}
 */
export function mergeDeltaIntoCapability({ projDir, capId, reqId, deltaPath, by = "", dryRun = false }) {
  return withBoardLock(projDir, () => {
    const idx = readCapIndex(projDir);
    const entry = findCapEntry(idx.capabilities, capId);
    if (!entry) return { ok: false, error: `能力 ${capId} 不在目录里（gd cap list 查看）` };
    if (entry.status === "retired") return { ok: false, error: `能力 ${capId} 已退役（只读）：不再接受 delta` };

    const parsed = readDelta(projDir, deltaPath);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const spec = readCapSpec(projDir, capId);
    const events = readCapEvents(projDir, capId);
    // 幂等判据：这份 delta 文件合过；或（兼容早期手写事件）该需求已经合过
    // 幂等判据：**这份 delta 文件**合过（`merged` 只由 delta 合入写；手写判据事件是 req-added/-updated/-removed，
    //   不参与幂等判定 —— 否则「承诺者是这个需求」会被误当成「已经合过」）
    const alreadyMerged = events.some(
      (e) =>
        String(e?.state) === "merged" &&
        String(e?.req ?? "") === String(reqId) &&
        Array.isArray(e?.delta_paths) &&
        e.delta_paths.includes(String(deltaPath)),
    );

    // 冲突面 = 同一能力上**比我早登记、且还没合入**的 delta。
    //   「先到先得」：后登记者不插队（否则两条 delta 互锁，谁都合不进去 —— 死锁比冲突更糟）；
    //   早的那条合入后，后者的冲突面自然消失，逐个推进。
    const selfSeq = seqOfReq(projDir, reqId);
    const pending = pendingDeltasOf(projDir, capId, reqId).filter((p) => p.seq < selfSeq);

    const applied = applyDelta({
      spec,
      delta: parsed.delta,
      reqId,
      capId,
      pending,
      alreadyMerged,
    });
    if (!applied.ok) return { ok: false, error: applied.error };

    if (applied.result.idempotent) {
      return { ok: true, result: applied.result, revision: Number(spec.revision ?? 1) || 1, idempotent: true };
    }
    if (dryRun) {
      return { ok: true, result: applied.result, revision: Number(applied.spec.revision ?? 1) || 1, dryRun: true };
    }

    writeCapSpec(projDir, capId, applied.spec);
    syncCapEntryDerived(projDir, idx, entry, applied.spec);
    appendCapEvents(projDir, capId, [{
      state: "merged",
      by,
      req: reqId,
      delta_paths: [String(deltaPath)],
      added: applied.result.added,
      modified: applied.result.modified.map((id) => ({ id })),
      removed: applied.result.removed,
    }]);
    return { ok: true, result: applied.result, revision: Number(applied.spec.revision ?? 1) || 1 };
  });
}

/**
 * 同一能力上**别的需求**的未合入 delta（冲突检测的输入）。
 * 只看已经合入过的 delta 不算；读不出来的 delta 直接忽略（它自己会在 merge 时报错）。
 */
function pendingDeltasOf(projDir, capId, selfReqId) {
  const mergedReqs = new Set(readCapEvents(projDir, capId).filter((e) => String(e?.state) === "merged").flatMap((e) => [String(e?.req ?? "")]));
  const out = [];
  let reqIds = [];
  try {
    reqIds = listReqIds(projDir);
  } catch {
    return out;
  }
  for (const rid of reqIds) {
    if (String(rid) === String(selfReqId)) continue;
    if (mergedReqs.has(String(rid))) continue;
    let bindings = [];
    try {
      bindings = readReqBindings(projDir, rid);
    } catch {
      continue;
    }
    for (const b of bindings) {
      if (String(b.id) !== String(capId) || !b.delta) continue;
      const parsed = readDelta(projDir, b.delta);
      if (!parsed.ok) continue;
      const titles = [...parsed.delta.added, ...parsed.delta.modified, ...parsed.delta.removed].map((x) => x.title);
      out.push({ reqId: rid, titles, seq: seqOfReq(projDir, rid) });
    }
  }
  return out;
}

/** 需求在本板账里的登记序（`created` 同日时用 id 尾号兜底；读不到 ⇒ 极大值，等于「最后到」） */
function seqOfReq(projDir, reqId) {
  try {
    const hit = readReqEntries(projDir).find((e) => String(e?.id ?? "").trim() === String(reqId).trim());
    if (!hit) return Number.MAX_SAFE_INTEGER;
    const created = String(hit.created ?? "").replace(/-/g, "");
    const tail = Number(String(reqId).match(/(\d+)$/)?.[1] ?? 0);
    return Number(created || 0) * 1e6 + tail;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * 数字字段归一（防引号累积）：本仓 YAML 解析器不剥引号，写侧一旦把 `"4"` 当字符串写回，
 *   下一轮读出来就是 `""4""` —— 剥到稳定为止，再转数。
 */
function numOf(v, dflt) {
  if (typeof v === "number") return Number.isFinite(v) ? v : dflt;
  let s = String(v ?? "").trim();
  let guard = 0;
  while (guard++ < 5 && s.length >= 2 && ((s.startsWith(') && s.endsWith(')) || (s.startsWith(") && s.endsWith(")))) {
    s = s.slice(1, -1).trim();
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : dflt;
}

// ── 缺陷挂点（0.66 · capability_ref）────────────────────────────

/**
 * 解析 `--capability-ref <能力id>[/<R#>[/<S#>]]`：三段式，越往下越具体。
 *   · 一段（`req-intake`）：只知道违反哪项能力，判据待定位
 *   · 两段（`req-intake/R1`）：定位到判据
 *   · 三段（`req-intake/R1/S2`）：定位到场景（最有用 —— 缺陷本身就是场景失败）
 * @param {string} raw
 * @returns {{ok: true, ref: {capability: string, requirement: string, scenario: string}} | {ok: false, error: string}}
 */
export function parseCapabilityRef(raw) {
  const s = String(raw ?? "").trim().replace(/\s+/g, "");
  if (!s) return { ok: false, error: "capability_ref 为空" };
  const parts = s.split("/");
  if (parts.length > 3) return { ok: false, error: `capability_ref 最多三段（能力/判据/场景）：收到 "${raw}"` };
  const [capability, requirement = "", scenario = ""] = parts;
  const p = capIdProblem(capability);
  if (p) return { ok: false, error: `capability_ref 里的能力 id 不合法：${p}` };
  if (requirement && !CAP_REQ_ID_RE.test(requirement)) {
    return { ok: false, error: `capability_ref 第二段应为判据号 R<n>：收到 "${requirement}"` };
  }
  if (scenario && !CAP_SCEN_ID_RE.test(scenario)) {
    return { ok: false, error: `capability_ref 第三段应为场景号 S<n>：收到 "${scenario}"` };
  }
  if (scenario && !requirement) return { ok: false, error: "capability_ref 给了场景却没给判据（三级要自左向右给）" };
  return { ok: true, ref: { capability, requirement, scenario } };
}

/**
 * 校验能力引用链是否都指向存在的东西（返回问题清单）。
 * @param {{projDir: string, ref: {capability: string, requirement?: string, scenario?: string}}} o
 */
export function capabilityRefProblems({ projDir, ref }) {
  const probs = [];
  if (!ref?.capability) return ["capability_ref 缺能力 id"];
  const idx = readCapIndex(projDir);
  const entry = findCapEntry(idx.capabilities, ref.capability);
  if (!entry) {
    probs.push(`能力 ${ref.capability} 不在板上（gd cap list 查看）`);
    return probs;
  }
  if (!ref.requirement) return probs;
  const spec = readCapSpec(projDir, ref.capability);
  const req = (spec.requirements ?? []).find((r) => String(r?.id) === String(ref.requirement));
  if (!req) {
    probs.push(`能力 ${ref.capability} 没有判据 ${ref.requirement}（gd cap show ${ref.capability} 查看）`);
    return probs;
  }
  if (!ref.scenario) return probs;
  const scen = (req.scenarios ?? []).find((s) => String(s?.id) === String(ref.scenario));
  if (!scen) {
    probs.push(`判据 ${ref.capability}/${ref.requirement} 没有场景 ${ref.scenario}`);
  }
  return probs;
}

/** 能力引用渲染成单行文本（落盘与回显共用一种写法） */
export function renderCapabilityRef(ref) {
  const parts = [ref?.capability ?? "", ref?.requirement ?? "", ref?.scenario ?? ""].filter(Boolean);
  return parts.join("/");
}

/** 读需求条目的 capability_ref（缺省 = null） */
export function readCapabilityRef(projDir, reqId) {
  const ent = readReqEntries(projDir).find((e) => String(e?.id ?? "").trim() === String(reqId).trim());
  if (!ent) return null;
  const raw = String(ent.capability_ref ?? "").trim();
  if (!raw) return null;
  const parsed = parseCapabilityRef(raw);
  return parsed.ok ? parsed.ref : null;
}

/**
 * 板上所有挂了能力引用的缺陷（读面用：`gd cap show` 的「挂在这条判据上的缺陷」）。
 * @param {{projDir: string, capability?: string, requirement?: string, scenario?: string}} o
 */
export function defectsOfCapability({ projDir, capability = null, requirement = null, scenario = null }) {
  const out = [];
  for (const ent of readReqEntries(projDir)) {
    const id = String(ent?.id ?? "").trim();
    if (!/^B-/.test(id)) continue; // 缺陷 id 前缀是 B-
    const ref = readCapabilityRef(projDir, id);
    if (!ref) continue;
    if (capability && ref.capability !== String(capability)) continue;
    if (requirement && ref.requirement !== String(requirement)) continue;
    if (scenario && ref.scenario !== String(scenario)) continue;
    out.push({ id, title: String(ent.title ?? ""), severity: String(ent.severity ?? ""), ref });
  }
  return out;
}

// ── 合入状态（0.67 · 顺序可查）──────────────────────────────────

/**
 * 某需求在某能力上的合入状态。
 *
 * 「合入」只认带 `delta_paths` 的 merged 事件（0.63 起）；手写判据事件不参与判定。
 * @param {object[]} events 能力级事件流
 * @param {string} reqId
 * @returns {{merged: boolean, at: string|null, deltaPaths: string[]}}
 */
export function mergeStateOf(events, reqId) {
  const rows = (events ?? []).filter(
    (e) => String(e?.state) === "merged" && String(e?.req ?? "") === String(reqId) && Array.isArray(e?.delta_paths),
  );
  if (rows.length === 0) return { merged: false, at: null, deltaPaths: [] };
  return { merged: true, at: String(rows[rows.length - 1].at ?? ""), deltaPaths: rows.flatMap((r) => r.delta_paths) };
}

/**
 * 某需求挂点里「有 delta 但还没合入」的能力（验收时的顺序检查）。
 *
 * 不阻断验收 —— 它是一条**警告事实**：说明「这单说改了规范，但规范还没长」。
 * @param {{projDir: string, reqId: string}} o
 * @returns {{capId: string, delta: string}[]}
 */
export function unmergedBindingsOf({ projDir, reqId }) {
  let bindings = [];
  try {
    bindings = readReqBindings(projDir, reqId);
  } catch {
    return [];
  }
  const out = [];
  for (const b of bindings) {
    if (!b.delta) continue;
    let events = [];
    try {
      events = readCapEvents(projDir, b.id);
    } catch {
      continue;
    }
    const st = mergeStateOf(events, reqId);
    if (!st.merged || !st.deltaPaths.includes(String(b.delta))) out.push({ capId: b.id, delta: String(b.delta) });
  }
  return out;
}

// ── 能力影响面（0.69 · 交付件 × 载体）──────────────────────────

/** 路径归一：反斜杠 → 正斜杠 + 去首尾空白（尾随 `/` 原样保留，供目录前缀匹配） */
const normPath = (p) => String(p ?? "").trim().split("\\").join("/");

/**
 * 读任务账里的交付件清单；**只吞「读不出来」**（账缺失 / 坏行）。
 * 编程错（如漏 import 造成的 ReferenceError / 形状错 TypeError）必须照抛 ——
 *   否则影响面永远算成 0 而没人发现（实测踩过：`readTaskLedger` 没 import，被 catch 吞成空账）。
 */
function readLedgerTasks(projDir, reqId) {
  try {
    return readTaskLedger(projDir, reqId) ?? { tasks: [] };
  } catch (e) {
    if (e instanceof ReferenceError || e instanceof TypeError) throw e;
    return { tasks: [] };
  }
}

/**
 * 本次需求「碰了哪些能力」——把**已登记交付件**与全板能力的**载体指针**求交。
 *
 * 三条边界（诚实标注，回显要给出去）：
 *   · 只认**已登记**的交付件（任务账 `artifacts[]`）；没登记交付件的改动算不出来
 *     ⇒ 这条命令是「提示 + 脚手架」，不是「审计」；走 git diff 是后续事。
 *   · 载体 `kind: uri` 不参与（外部链接没有仓内路径可比）。
 *   · 匹配口径：交付件是文件 ⇒ 精确相等；交付件是目录（尾随 `/`）⇒ 前缀匹配。
 *
 * @param {{projDir: string, reqId: string}} o
 * @returns {{hits: {capId: string, path: string, artifact: string, taskId: string}[], artifactCount: number, carrierCount: number, note: string}}
 */
export function capabilityImpactOf({ projDir, reqId }) {
  const idx = readCapIndex(projDir);
  const carrierMap = new Map(); // 载体路径 → 能力 id 列表
  for (const c of idx.capabilities ?? []) {
    for (const car of c.carriers ?? []) {
      const p = normPath(car.path);
      if (!p) continue; // uri 载体的 path 为空，天然跳过
      const capIds = carrierMap.get(p);
      if (capIds) capIds.push(String(c.id));
      else carrierMap.set(p, [String(c.id)]);
    }
  }
  const ledger = readLedgerTasks(projDir, reqId);
  const artifacts = [];
  for (const t of ledger.tasks ?? []) {
    for (const a of t.artifacts ?? []) {
      const p = normPath(a?.path);
      if (p) artifacts.push({ path: p, taskId: String(t.id ?? "") });
    }
  }
  const hits = [];
  const seen = new Set();
  for (const a of artifacts) {
    const isDir = a.path.endsWith("/");
    for (const [cp, caps] of carrierMap) {
      const matched = isDir ? cp.startsWith(a.path) : cp === a.path;
      if (!matched) continue;
      for (const capId of caps) {
        const key = `${capId}\u0000${cp}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ capId, path: cp, artifact: a.path, taskId: a.taskId });
      }
    }
  }
  const note = artifacts.length === 0
    ? "本需求任务账里没有已登记交付件 ⇒ 算不出影响面（这不是「没碰任何能力」，是「没证据」）"
    : "口径：只认已登记交付件（任务账 artifacts），未登记交付件的改动算不出来";
  return { hits, artifactCount: artifacts.length, carrierCount: carrierMap.size, note };
}

/** delta 骨架：ADDED 段（正常填）+ MODIFIED / REMOVED 段（只在需要时打开） */
const DELTA_ADDED_TEMPLATE = [
  "## ADDED Requirements",
  "",
  "### Requirement: <新判据标题>",
  "系统 SHALL <一句话，可判定>。",
  "",
  "#### Scenario: <场景名>",
  "- WHEN <触发条件>",
  "- THEN <可观察的结果>",
];

const DELTA_MODIFIED_REMOVED_TEMPLATE = [
  "## MODIFIED Requirements",
  "",
  "### Requirement: <上面清单里的判据标题，原样>",
  "系统 SHALL <新的一句话>。",
  "",
  "#### Scenario: <场景名>",
  "- WHEN <触发条件>",
  "- THEN <可观察的结果>",
  "",
  "## REMOVED Requirements",
  "",
  "### Requirement: <要废掉的判据标题，原样>",
];

/**
 * 渲染 delta 草稿（脚手架，**不参与合入**）。
 *
 * 为什么只给骨架 + 现有判据清单：判据正文（MUST / 场景）必须由人写 —— 机器只能
 *   告诉人「你碰的是哪项能力、它现在承诺了哪几条」。自动编 MUST 就是替人署名的伪造账。
 */
export function renderDeltaDraft({ capId, spec = {}, reqId = "", paths = [] }) {
  const reqs = spec.requirements ?? [];
  const existing = reqs.length === 0
    ? ["     （还没有判据）"]
    : reqs.map((r) => `     - ${r.id} ${r.title ?? ""} → ${String(r.must ?? "").slice(0, 40)}`);
  return [
    `# Delta for ${capId}（草稿 · 由 gd cap draft 生成 · 不参与合入）`,
    "",
    `<!-- 需求：${reqId}`,
    `     命中的载体：${paths.join(" / ")}`,
    "     怎么用：把判据写进下面的段 → 存成同名去掉 .draft 的文件（或 gd cap import）→ gd cap merge",
    "     本文件不会被 cap merge 读到；不写就等于「本次判据不变」 -->",
    "",
    "<!-- 本能力现有判据（改哪条就把它的标题原样抄到 MODIFIED 段）：",
    ...existing,
    "-->",
    "",
    ...DELTA_ADDED_TEMPLATE,
    "",
    "<!-- 只在需要时打开下面两段：",
    ...DELTA_MODIFIED_REMOVED_TEMPLATE,
    "-->",
  ].join("\n") + "\n";
}

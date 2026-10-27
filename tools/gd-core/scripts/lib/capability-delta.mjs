/**
 * capability-delta —— delta 规范正文的解析与合入（m-6 · 0.63 R-gm-63-0 · core 层）
 *
 * delta = 一次需求对能力判据的**增量说明**，三段式（照 OpenSpec 的形状，按 gd 的口径收严）：
 *
 *   # Delta for <能力id>
 *   ## ADDED Requirements
 *   ### Requirement: <判据标题>
 *   <一句 MUST>
 *   #### Scenario: <场景名>
 *   - WHEN <触发>
 *   - THEN <结果>
 *
 *   ## MODIFIED Requirements   （判据标题必须已存在）
 *   ## REMOVED Requirements    （判据标题必须已存在）
 *
 * **为什么是「标题」而不是编号**：写 delta 的人（席位 / 人）手里只有能力规范的读面；
 *   让它们去猜 `R7` 是几号，改一次就得回账里翻一次。标题是稳定的业务标识；
 *   编号在合入时才由账自己给（新增）或由标题匹配到（修改 / 删除）。
 *
 * 解析严格档（比 OpenSpec 严）：OpenSpec 对未应用内容只给 warning，gd 一律拒——
 *   判据是账面事实，解析含糊会直接脏账（详设 §4.2）。
 */
import { existsSync, readFileSync } from "node:fs";

/** 三段（次序固定，段可缺省但出现时必须合法） */
export const DELTA_SECTIONS = ["ADDED", "MODIFIED", "REMOVED"];

/** 段名 -> 归一 key */
const SECTION_KEY = { ADDED: "added", MODIFIED: "modified", REMOVED: "removed" };

/** `### Requirement: <标题>` 头 */
const REQ_HEAD_RE = /^###\s+Requirement:\s*(.+?)\s*$/i;
/** `#### Scenario: <名称>` 头 */
const SCEN_HEAD_RE = /^####\s+Scenario:\s*(.+?)\s*$/i;
/** `## <段名> Requirements` */
const SECTION_RE = /^##\s+(ADDED|MODIFIED|REMOVED)\s+Requirements\s*$/i;

/**
 * 解析 delta 文件。
 *
 * @param {string} text Markdown 正文
 * @returns {{ok: true, delta: {added: object[], modified: object[], removed: object[]}}
 *         | {ok: false, error: string}}
 */
export function parseDelta(text) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const out = { added: [], modified: [], removed: [] };
  const problems = [];
  let section = null;
  let cur = null; // 当前判据
  let curScen = null; // 当前场景
  let body = []; // 判据正文行（MUST）
  const seen = { ADDED: new Set(), MODIFIED: new Set(), REMOVED: new Set() };

  const flushScen = () => {
    if (!curScen) return;
    if (!curScen.name) problems.push(`判据「${cur?.title ?? "?"}」下有场景缺名称`);
    if (!curScen.when) problems.push(`判据「${cur?.title ?? "?"}」/ 场景「${curScen.name}」缺 WHEN`);
    if (!curScen.then) problems.push(`判据「${cur?.title ?? "?"}」/ 场景「${curScen.name}」缺 THEN`);
    if (cur && section) out[SECTION_KEY[section]] && cur.scenarios.push(curScen);
    curScen = null;
  };
  const flushReq = () => {
    flushScen();
    if (!cur || !section) return;
    const must = body.join("\n").trim();
    // REMOVED 段只按标题删、不描述行为 —— 不要求 MUST（要求了就是逼人写两句假话）
    if (!must && section !== "REMOVED") {
      problems.push(`判据「${cur.title}」缺 MUST 正文（Requirement 头下面要有一句「系统 SHALL …」）`);
    }
    const item = { title: cur.title, must, scenarios: cur.scenarios };
    const key = SECTION_KEY[section];
    // ADDED / MODIFIED 必须至少一条场景：没有场景的判据不可验证（与 lib/capability-ledger 的判据形态同口径）
    if (key !== "removed" && cur.scenarios.length === 0) {
      problems.push(`判据「${cur.title}」至少需要一个场景（没有场景的判据不可验证）`);
    }
    if (key === "removed" && cur.scenarios.length > 0) {
      problems.push(`REMOVED 段的判据「${cur.title}」不该带场景（删就删，不描述行为）`);
    }
    if (seen[section]?.has(cur.title)) problems.push(`${section} 段里判据标题重复：${cur.title}`);
    seen[section]?.add(cur.title);
    out[key].push(item);
    cur = null;
    body = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const sec = line.match(SECTION_RE);
    if (sec) {
      flushReq();
      section = sec[1].toUpperCase();
      continue;
    }
    const reqM = line.match(REQ_HEAD_RE);
    if (reqM) {
      flushReq();
      if (!section) {
        problems.push(`判据「${reqM[1]}」出现在任何 ADDED / MODIFIED / REMOVED 段之外`);
        continue;
      }
      cur = { title: reqM[1].trim(), scenarios: [] };
      continue;
    }
    const scM = line.match(SCEN_HEAD_RE);
    if (scM) {
      flushScen();
      if (!cur) {
        problems.push(`场景「${scM[1]}」不在任何 Requirement 之下`);
        continue;
      }
      curScen = { name: scM[1].trim(), when: "", then: "" };
      continue;
    }
    const item = line.match(/^\s*[-*]?\s*(WHEN|THEN|GIVEN|AND)\s+(.+?)\s*$/i);
    if (item && curScen) {
      const kw = item[1].toUpperCase();
      const val = item[2].trim();
      if (kw === "WHEN" || kw === "GIVEN") curScen.when = curScen.when ? `${curScen.when}；${val}` : val;
      else if (kw === "THEN") curScen.then = curScen.then ? `${curScen.then}；${val}` : val;
      else if (kw === "AND") {
        // AND 归属上一句：接在 then 后面（没有 then 就接 when）
        if (curScen.then) curScen.then = `${curScen.then}；${val}`;
        else curScen.when = curScen.when ? `${curScen.when}；${val}` : val;
      }
      continue;
    }
    // 判据正文（MUST）：`# 标题` / 空行 / 注释以外的行
    if (cur && !curScen) {
      if (line.trim() === "") continue;
      if (/^#\s/.test(line)) continue; // 文件大标题
      body.push(line.trim());
    }
  }
  flushReq();

  if (problems.length > 0) return { ok: false, error: problems.join("；") };
  const total = out.added.length + out.modified.length + out.removed.length;
  if (total === 0) return { ok: false, error: "delta 里一条判据都没有（至少写一段 ADDED / MODIFIED / REMOVED Requirements）" };
  return { ok: true, delta: out };
}

/** delta 文件路径（相对板根）：`reqs/<需求id>/specs/<能力id>.md` */
export function deltaPathOf(reqId, capId) {
  return `reqs/${reqId}/specs/${capId}.md`;
}

/**
 * 读并解析 delta（不存在 / 解析失败都给出可执行的话）。
 * @param {string} projDir 板根
 * @param {string} relPath 相对板根路径
 */
export function readDelta(projDir, relPath) {
  const abs = `${projDir}/${String(relPath).replace(/\\/g, "/")}`;
  if (!existsSync(abs)) return { ok: false, error: `delta 文件不存在：${relPath}` };
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch (e) {
    return { ok: false, error: `delta 文件读不出来（${relPath}）：${e.message}` };
  }
  const parsed = parseDelta(text);
  if (!parsed.ok) return { ok: false, error: `${relPath} 解析失败：${parsed.error}` };
  return { ok: true, delta: parsed.delta, path: relPath };
}

// ── 需求侧挂点（bind）─────────────────────────────────────────

/** 需求条目里的 `capabilities[]` 读成列表（字段缺失 = 未挂） */
export function normalizeBindings(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => ({
      id: String(b?.id ?? "").trim(),
      role: String(b?.role ?? "owner").trim() || "owner",
      delta: b?.delta ? String(b.delta).trim() : "",
    }))
    .filter((b) => b.id);
}

/**
 * 校验一组挂点（返回问题清单）。
 *   · 能力必须存在（不会凭空挂）
 *   · `role: owner` **唯一**（主责只能一个 —— 不然「这次演进是谁负责」读不出来）
 *   · `role` 只能 owner / consumer
 *   · delta 路径给了就必须存在（写面拒绝留下指向空气的路径）
 */
export function bindingProblems(bindings, { capExists, deltaExists }) {
  const probs = [];
  const owners = bindings.filter((b) => b.role === "owner");
  if (owners.length > 1) probs.push(`role=owner 只能有一个（现值 ${owners.map((b) => b.id).join(" / ")}）`);
  for (const b of bindings) {
    if (!["owner", "consumer"].includes(b.role)) probs.push(`能力 ${b.id}：role 只能是 owner / consumer（现值 "${b.role}"）`);
    if (!capExists(b.id)) probs.push(`能力 ${b.id} 不在板上（gd cap list 查看）`);
    if (b.delta && !deltaExists(b.delta)) probs.push(`能力 ${b.id}：delta 文件不存在（${b.delta}）`);
  }
  return probs;
}

// ── 合入（merge）──────────────────────────────────────────────

/**
 * 把一份 delta 合进能力判据。
 *
 * 语义（详设 §4.3）：
 *   · ADDED   → 追加判据（state=committed · committed_by=该需求）
 *   · MODIFIED → 按**标题**匹配已有判据，替换正文（回 committed）；匹配不到即拒
 *   · REMOVED → 按**标题**匹配并移除；匹配不到即拒
 *   · 冲突：另一条**未合入**的 delta 改了同一条判据 ⇒ 拒并点名
 *   · 幂等：该需求已合入过这份 delta ⇒ 幂等成功，不重复写
 *
 * 调用方负责在板锁内调用（本函数不做加锁 —— 事务边界在外层，回滚也就有地方做）。
 *
 * @param {{spec: object, delta: object, reqId: string, capId: string,
 *          pending?: {reqId: string, titles: string[]}[], alreadyMerged?: boolean}} o
 * @returns {{ok: true, result: object, spec: object} | {ok: false, error: string}}
 */
export function applyDelta({ spec, delta, reqId, capId, pending = [], alreadyMerged = false }) {
  if (alreadyMerged) return { ok: true, result: { idempotent: true, added: [], modified: [], removed: [] }, spec };
  const reqs = [...(spec.requirements ?? [])];
  const byTitle = (t) => reqs.find((r) => String(r?.title ?? "").trim() === String(t).trim());

  // ── 前置校验（一次报全，别让人来回试）──
  const probs = [];
  for (const m of delta.modified ?? []) if (!byTitle(m.title)) probs.push(`MODIFIED 的目标判据不存在：${m.title}`);
  for (const r of delta.removed ?? []) if (!byTitle(r.title)) probs.push(`REMOVED 的目标判据不存在：${r.title}`);
  for (const a of delta.added ?? []) if (byTitle(a.title)) probs.push(`ADDED 的判据已存在（要改请用 MODIFIED）：${a.title}`);
  // 冲突：别的未合入 delta 改了同一条判据
  const touched = new Set([...(delta.modified ?? []), ...(delta.removed ?? []), ...(delta.added ?? [])].map((x) => String(x.title).trim()));
  for (const p of pending) {
    if (String(p.reqId) === String(reqId)) continue;
    const clash = (p.titles ?? []).filter((t) => touched.has(String(t).trim()));
    if (clash.length > 0) {
      probs.push(`与未合入的 delta 冲突（需求 ${p.reqId}）：${clash.join(" / ")} —— 两条 delta 改同一条判据，先合一条或由人裁决`);
    }
  }
  if (probs.length > 0) return { ok: false, error: probs.join("；") };

  // ── 应用 ──
  const addedIds = [];
  const removedIds = [];
  const modifiedIds = [];
  let nextNo = nextReqNoOf(reqs);
  for (const a of delta.added ?? []) {
    const id = `R${nextNo++}`;
    reqs.push({
      id,
      title: a.title,
      must: a.must,
      state: "committed",
      committed_by: reqId,
      fulfilled_at: null,
      scenarios: (a.scenarios ?? []).map((s, i) => ({ id: `S${i + 1}`, name: s.name, when: s.when, then: s.then })),
    });
    addedIds.push(id);
  }
  for (const m of delta.modified ?? []) {
    const at = reqs.findIndex((r) => String(r?.title ?? "").trim() === String(m.title).trim());
    const before = reqs[at];
    reqs[at] = {
      ...before,
      must: m.must,
      state: "committed", // 正文变了 = 新承诺
      committed_by: reqId,
      fulfilled_at: null,
      evidence: [],
      scenarios: (m.scenarios ?? []).map((s, i) => ({ id: `S${i + 1}`, name: s.name, when: s.when, then: s.then })),
    };
    modifiedIds.push(before.id);
  }
  for (const r of delta.removed ?? []) {
    const at = reqs.findIndex((x) => String(x?.title ?? "").trim() === String(r.title).trim());
    removedIds.push(reqs[at].id);
    reqs.splice(at, 1);
  }

  return {
    ok: true,
    spec: { ...spec, revision: (Number(spec.revision ?? 1) || 1) + 1, requirements: reqs },
    result: { added: addedIds, modified: modifiedIds, removed: removedIds, idempotent: false },
  };
}

/** 下一个判据号（取现存最大 + 已删号由事件流保证不复用 ⇒ 这里只按现存最大递增即可，删号在事件里） */
function nextReqNoOf(reqs) {
  const nums = reqs.map((r) => Number(String(r?.id ?? "").match(/^R(\d+)$/)?.[1] ?? 0)).filter((n) => n > 0);
  return nums.length === 0 ? 1 : Math.max(...nums) + 1;
}

// ── Markdown 视图（export / import）──────────────────────────────

/**
 * 渲染能力规范正文的 Markdown 视图（OpenSpec 风格的 spec.md）。
 * **视图不是事实源**：内容全部从 spec.yaml 派生，改它无效（要改走 cap req / delta）。
 */
export function renderSpecMarkdown({ capId, entry = {}, spec = {} }) {
  const lines = [`# ${entry.title ?? capId} Specification`, ""];
  lines.push("## Purpose", "");
  lines.push(entry.purpose ? String(entry.purpose) : `（未填目的 —— 能力 ${capId} 还只是名字与判据）`, "");
  lines.push("## Requirements", "");
  for (const r of spec.requirements ?? []) {
    lines.push(`### Requirement: ${r.title ?? r.id}`);
    lines.push(String(r.must ?? ""));
    const state = String(r.state ?? "committed");
    lines.push("");
    lines.push(`<!-- ${r.id} · ${state}${r.committed_by ? ` · 承诺者 ${r.committed_by}` : ""}${r.fulfilled_at ? ` · 兑现于 ${r.fulfilled_at}` : ""} -->`);
    lines.push("");
    for (const s of r.scenarios ?? []) {
      lines.push(`#### Scenario: ${s.name ?? s.id}`);
      lines.push(`- WHEN ${s.when ?? ""}`);
      lines.push(`- THEN ${s.then ?? ""}`);
      lines.push("");
    }
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

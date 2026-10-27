/**
 * 里程碑账（0.15.4）—— **唯一实现**：字段口径 / 枚举 / 派生（排序 · 逾期）/ 读写
 *
 * 设计权威源：`docs/gd-entry-page-design.md` §11（v0.5 定案 T1–T5）。
 * 落点：`<项目库>/milestones.yaml`（项目级单文件 · 随项目库 git 版本化）。
 *
 * 消费方（三处共用本文件，勿各写一套）：
 *   ① `gd milestone` CLI（`scripts/reqs/milestone.mjs`）
 *   ② 工作站取数面（`scripts/lib/stationview.mjs` → `board.overview.milestones`）
 *   ③ 契约检查 C6（`scripts/contract-check.mjs` · 字段级合规）
 *
 * 四条口径：
 *   - **只呈现事实**：逾期（`overdue`）、时间线顺序、是否进行中（`is_active`）、关联需求进度都在**这里**算好，界面不再比日期 / 不再排序 / 不再查需求状态。
 *   - **三态不造中间态**：`planned | in_progress | reached`；「延期」不设状态，由 `target` + 逾期标记表达。
 *   - **`status` 是账面真值，可并行**：进行中的张数不设上限——多个里程碑可以同时 `in_progress`（多条版本线并行推进）。
 *     **不派生、不接棒**：写什么就是什么，达成一张不会顺手改动别人的状态；并行隔离靠版本线（`gd ver claim <x.y>`），
 *     不靠里程碑状态机。
 *   - **写面**：CLI `gd milestone` **与**工作站首页右栏「标记达成」（动作 `milestone.reach` · owner 专属）——两处都直写账面。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml, unquoteScalar } from "./yaml.mjs";

export const MILESTONES_FILE = "milestones.yaml";

/** 三态（顺序即界面排序优先级：未达成在前） */
export const MILESTONE_STATUSES = ["planned", "in_progress", "reached"];

/** 上游口径（历史 yaml 里出现过的写法归一用；当前写侧只产上述三态） */
const STATUS_ALIASES = { not_started: "planned", todo: "planned", doing: "in_progress", done: "reached" };

/** 已知字段（其余键在改写时**原样保留**，避免静默丢内容） */
export const MILESTONE_FIELDS = ["id", "name", "target", "status", "reached_on", "reqs", "alias", "note"];

/**
 * 存量字段（**只读兼容**）：老卡账上仍带版号（单值 `ver` 或区间 `ver_from`/`ver_to`）——
 *   两轴模型下版号归发版流程，里程碑不再带版号；老卡的这几项照旧可读、写侧不再产出。
 */
export const MILESTONE_LEGACY_FIELDS = ["ver", "ver_from", "ver_to"];

/** 开发线段形态：数字 + 线别字母（如 `1a`）——里程碑 id 去 `m-` 前缀后的样子 */
export const DEV_LINE_SEG_RE = /^\d+[a-z]$/;

/**
 * 里程碑的开发线段：id 去 `m-` 前缀（`m-1a` → `1a`）。
 * **必须是「数字 + 线别字母」**：存量卡（`m-1` … `m-6`，纯数字）不算开发线——
 * 那样它们会被误当成新模型卡，存量板的行为就会跟着变。
 * @param {object} m 里程碑条目
 * @returns {string} 空串 = 不是开发线卡
 */
export function devLineSegOf(m) {
  const id = String(m?.id ?? "").trim();
  if (!/^m-/i.test(id)) return "";
  const seg = id.slice(2);
  return DEV_LINE_SEG_RE.test(seg) ? seg : "";
}

/** 板上全部开发线卡（含其线段）——按 id 排 */
export function devLineCards(list) {
  return (list ?? [])
    .map((m) => ({ card: m, seg: devLineSegOf(m), id: String(m?.id ?? "") }))
    .filter((x) => x.seg !== "")
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

/** 版本号形态（**存量卡**的版号用 `x.y`；新模型下里程碑不带版号） */
export const MILESTONE_VER_RE = /^\d+\.\d+$/;

/** 是否里程碑版本号形态（`x.y`） */
export function isMilestoneVer(v) {
  return MILESTONE_VER_RE.test(String(v ?? "").trim());
}

/** `x.y` → 数字（比较 / 区间展开用；非形态返回 null） */
export function versionPartsOf(v) {
  const m = MILESTONE_VER_RE.exec(String(v ?? "").trim());
  return m ? String(v).trim().split(".").map(Number) : null;
}

/**
 * 版本序比对（**主次版本数字序**，非字符串序）：`0.9` < `0.10`。
 * 两个参数都不是 `x.y` 形态时返回 0（调用方自己先校验形态）。
 */
export function compareMilestoneVer(a, b) {
  const pa = versionPartsOf(a);
  const pb = versionPartsOf(b);
  if (!pa || !pb) return 0;
  return pa[0] - pb[0] || pa[1] - pb[1];
}

/**
 * 里程碑覆盖的版本号清单：**存量卡的版号**（单值 `ver` 或区间 `ver_from`/`ver_to`）——只读兼容。
 *
 * 两轴模型下里程碑不再带版号（版号归发版流程），所以这个函数只服务于**存量卡**：
 * 存量区间按两端连续展开（历史数据不迁移，读侧兼容）；新模型卡一律返回 `[]`。
 * @param {object|{ver?: string, ver_from?: string, ver_to?: string}} m 里程碑条目
 * @returns {string[]}
 */
export function milestoneVersions(m) {
  const single = String(m?.ver ?? "").trim();
  if (isMilestoneVer(single)) return [single];
  const from = versionPartsOf(m?.ver_from);
  const to = versionPartsOf(m?.ver_to);
  if (!from || !to) return [];
  if (compareMilestoneVer(m.ver_from, m.ver_to) > 0) return [];
  const list = [];
  let [major, minor] = from;
  for (;;) {
    list.push(`${major}.${minor}`);
    if (major === to[0] && minor === to[1]) break;
    minor += 1;
    if (minor > 99) {
      // 小版本进位：`0.99` → `1.0`（与版本号自身口径一致）
      major += 1;
      minor = 0;
    }
    if (list.length > 200) break; // 防手写超长区间把进程跑死（合法性由校验档报错）
  }
  return list;
}

/**
 * 里程碑的版号标签（人读用）：当前形态 = 单值版号（`0.70`）；存量卡 = 区间（`0.30~0.39`）；无版号 = 空串。
 * @param {object} m 里程碑条目
 * @returns {string}
 */
export function milestoneVerLabel(m) {
  const single = String(m?.ver ?? "").trim();
  if (single) return single;
  const from = String(m?.ver_from ?? "").trim();
  const to = String(m?.ver_to ?? "").trim();
  if (from && to) return `${from}~${to}`;
  return "";
}

/** 日期形态：`YYYY-MM-DD` 且真实存在（`2026-02-30` 之类的假日期不算） */
export function isMilestoneDate(v) {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** `now` → 本地日期串（逾期以**本地天**为准，跨零点即翻） */
export function dateStrOf(now = Date.now()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 相距天数（`to` 晚于 `from` 为正） */
export function dayGap(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function milestonesPathOf(projectDir) {
  return join(projectDir, MILESTONES_FILE);
}

const asText = (v, dflt = "") => {
  if (v === null || v === undefined) return dflt;
  if (typeof v === "object") return dflt; // 空值已被解析器读成 `{}`
  return unquoteScalar(String(v));
};
const asList = (v) => {
  if (Array.isArray(v)) return v.map((x) => asText(x)).filter((x) => x !== "");
  const s = asText(v);
  return s === "" ? [] : s.split(",").map((x) => x.trim()).filter((x) => x !== "");
};

/** yaml 原文（任一形态）→ 条目数组（已知字段归一 · 未知键原样留着） */
export function normalizeMilestones(doc) {
  const raw = doc?.milestones;
  const items = Array.isArray(raw) ? raw : [];
  return items
    .filter((m) => m && typeof m === "object")
    .map((m) => {
      const status0 = asText(m.status, "planned");
      const status = STATUS_ALIASES[status0] ?? status0;
      const out = {
        id: asText(m.id),
        name: asText(m.name),
        target: asText(m.target),
        status,
        reached_on: asText(m.reached_on) || null,
        // 版号：两轴模型下里程碑不再带版号（存量卡的 ver / ver_from / ver_to 只读兼容）。
        ver: asText(m.ver),
        ver_from: asText(m.ver_from),
        ver_to: asText(m.ver_to),
        reqs: asList(m.reqs),
        alias: asText(m.alias) || undefined, // 0.19.0 C5：版本号别名（读侧也要接，否则 UPDATE 时被静默丢）
        note: asText(m.note),
      };
      for (const [k, v] of Object.entries(m)) {
        if (MILESTONE_FIELDS.includes(k) || MILESTONE_LEGACY_FIELDS.includes(k)) continue;
        out[k] = typeof v === "object" ? undefined : asText(v);
      }
      for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
      return out;
    });
}

/**
 * 读账（**磁盘原文**，未排序、未派生）。
 * @returns {{ ok: boolean, exists: boolean, path: string, list: object[], error: string|null }}
 */
export function readMilestones(projectDir) {
  const path = milestonesPathOf(projectDir);
  if (!existsSync(path)) return { ok: true, exists: false, path, list: [], error: null };
  let doc;
  try {
    doc = parseYaml(readFileSync(path, "utf8"));
  } catch (e) {
    return { ok: false, exists: true, path, list: [], error: `解析失败：${e?.message ?? e}` };
  }
  return { ok: true, exists: true, path, list: normalizeMilestones(doc), error: null };
}

/**
 * 字段级校验（CLI 写前 + 契约 C6 共用）。
 * @param {object[]} list
 * @param {{ reqIds?: string[]|null }} [o] `reqIds` 提供时校验关联需求存在
 * @returns {{ code: string, id: string, msg: string }[]}
 */
export function validateMilestones(list, { reqIds = null } = {}) {
  const errors = [];
  const push = (code, id, msg) => errors.push({ code, id: id || "(缺 id)", msg });
  const seenIds = new Set();
  for (const m of list) {
    const id = String(m.id ?? "");
    if (id.trim() === "") push("E_M_ID", "", "缺 `id`");
    else if (seenIds.has(id)) push("E_M_DUP", id, `id 重复：${id}`);
    else seenIds.add(id);
    if (String(m.name ?? "").trim() === "") push("E_M_NAME", id, "缺 `name`");
    if (!isMilestoneDate(m.target)) push("E_M_TARGET", id, `\`target\` 必须是 YYYY-MM-DD 真实日期（现值：${m.target ?? "空"}）`);
    if (!MILESTONE_STATUSES.includes(m.status)) push("E_M_STATUS", id, `\`status\` 取值非法：${m.status ?? "空"}（合法：${MILESTONE_STATUSES.join(" | ")}）`);
    if (m.status === "reached") {
      if (!isMilestoneDate(m.reached_on)) push("E_M_REACHED_ON", id, "`status: reached` 时 `reached_on` 必填且为 YYYY-MM-DD");
    } else if (m.reached_on) {
      push("E_M_REACHED_ON", id, `非 reached 条目不得带 \`reached_on\`（现值：${m.reached_on}）`);
    }
    if (reqIds) for (const r of m.reqs ?? []) if (!reqIds.includes(r)) push("E_M_REQ", id, `关联需求不存在：${r}`);
    // 版号：**一张里程碑 = 一个版本**（当前形态）。
    //   `ver` 形态 `x.y`；不写版号放行（卡可以先开、版号后补）。
    //   存量卡带 ver_from/ver_to（区间形态）：**只读兼容**——两端同时给、形态合法、不倒置即可，不迁移、不重判跨度。
    //   版号形态混用（`ver` 与存量区间并存）⇒ 拒：写侧只留 `ver`。
    const ver = String(m.ver ?? "").trim();
    const verFrom = String(m.ver_from ?? "").trim();
    const verTo = String(m.ver_to ?? "").trim();
    const hasLegacy = Boolean(verFrom || verTo);
    if (ver && hasLegacy) {
      push("E_M_VER_MIX", id, `版号形态混用：ver=${ver} 与存量区间 ${verFrom}~${verTo} 不能并存——写侧只留 \`ver\``);
    } else if (ver) {
      if (!isMilestoneVer(ver)) push("E_M_VER_FORM", id, `版号形态非法：ver=${ver}（应为 \`x.y\`，如 0.70）`);
    } else if (hasLegacy) {
      if (!verFrom || !verTo) {
        push("E_M_VER_PAIR", id, `存量区间需**两端同时给**：ver_from=${verFrom || "空"} / ver_to=${verTo || "空"}`);
      } else {
        const badForm = [!isMilestoneVer(verFrom) ? `ver_from=${verFrom}` : "", !isMilestoneVer(verTo) ? `ver_to=${verTo}` : ""].filter(Boolean);
        if (badForm.length > 0) {
          push("E_M_VER_FORM", id, `存量区间形态非法：${badForm.join(" ")}（应为 \`x.y\`，如 0.30）`);
        } else if (compareMilestoneVer(verFrom, verTo) > 0) {
          push("E_M_VER_ORDER", id, `存量区间倒置：ver_from ${verFrom} > ver_to ${verTo}`);
        }
      }
    }
    // alias = **里程碑意涵缩写**（简短英文，如 `self-host`）——不参与排序、不产生派生态。
    //   版本号（`0.19.0` 这类）属「版本/子版」层，不再挂在里程碑上；
    //   0.20.x 之前的历史数据仍是版本号形态，故一并放行（折叠迁移时清掉）。
    if (m.alias !== undefined && m.alias !== null && m.alias !== "") {
      const alias = String(m.alias);
      const isMeaning = /^[a-z][a-z0-9-]*$/.test(alias);
      const isLegacyVersion = /^\d+\.\d+(\.\d+)?$/.test(alias);
      if (!isMeaning && !isLegacyVersion) {
        push("E_M_ALIAS", id, `\`alias\` 需为简短英文意涵缩写（kebab，如 self-host；现值：${alias}）`);
      }
    }
  }
  // 一个版本号只能归一张里程碑（跨里程碑唯一）——按每张卡的**版本集合**两两比（单值版号与存量区间同口径）
  const owned = list
    .map((m) => ({ id: String(m.id ?? ""), vers: milestoneVersions(m) }))
    .filter((x) => x.vers.length > 0);
  for (let i = 0; i < owned.length; i++) {
    for (let j = i + 1; j < owned.length; j++) {
      const dup = owned[i].vers.find((v) => owned[j].vers.includes(v));
      if (dup) push("E_M_VER_OVERLAP", owned[i].id, `版本 ${dup} 同时归 ${owned[i].id} 与 ${owned[j].id}——一个版本号只能归一张里程碑`);
    }
  }
  return errors;
}

/**
 * 存量卡版号（`ver`）的写入口判据 —— **口径唯一实现**（完整 CLI `gd milestone update` 与 core 面共用一份）。
 *
 * 背景：两轴模型下**开发线不占版号**（版号归发版账），但存量卡账上仍带 `ver`（只读兼容）。
 *   于是会出现**错标**：卡上标的版号与它实际承载的活不在同一条线上
 *   （例：m-1 标 `0.29`，而 0.29 上的活已归 m-2 / m-1a）——
 *   读侧据此判「版本线上的需求没挂该里程碑」，而写侧此前**没有**改 `ver` 的入口 ⇒ 错标只能手改 yaml 纠正。
 *
 * 口径（`--ver`）：
 *   · `--ver <x.y>`：给存量卡标定它真正占的那条版本线；**新模型卡（开发线卡）拒**（卡不带版号）。
 *   · `--ver ""`（空串）：清除版号 —— 让错标卡回到「存量卡不带版号」的常态。
 *   · **一个版本号只能归一张卡**（跨卡唯一）；与存量区间字段（ver_from/ver_to）**形态不混用**。
 *   · 已达成的卡 = 历史锚：改它的版号要点名确认（`--confirm <id>`），并留痕。
 *
 * @param {{list: object[], cur: object, rawVer: unknown, confirmed?: boolean}} o
 * @returns {{ok: true, patch: object, from: string|null, to: string|null, trace: string, unchanged?: boolean}
 *         | {ok: false, code: string, error: string, hint?: string}}
 */
export function planMilestoneVerPatch({ list, cur, rawVer, confirmed = false }) {
  const curVer = String(cur?.ver ?? "").trim();
  const isDevLine = devLineSegOf(cur) !== "";
  const legacyRange = Boolean(String(cur?.ver_from ?? "").trim() || String(cur?.ver_to ?? "").trim());
  // ── 清除（`--ver ""`）──
  if (rawVer === true) {
    return { ok: false, code: "E_M_VER_ARG", error: "`--ver` 缺值（给版号写 `x.y`；要清除给空串：`--ver \"\"`）" };
  }
  const raw = String(rawVer ?? "").trim();
  if (raw === "") {
    if (legacyRange) {
      return { ok: false, code: "E_M_VER_MIX", error: `${cur.id} 是存量区间卡（ver_from~ver_to）——它没有单值 ver 可清除` };
    }
    if (!curVer) return { ok: true, patch: {}, from: null, to: null, trace: "ver —（本就无版号）", unchanged: true };
    if (cur.status === "reached" && !confirmed) {
      return {
        ok: false,
        code: "E_M_REACHED_VER",
        error: `${cur.id} 已于 ${cur.reached_on ?? "—"} 达成——改它的版号要点名确认`,
        hint: `gd milestone update ${cur.id} --ver "" --confirm ${cur.id}`,
      };
    }
    return { ok: true, patch: { ver: null }, from: curVer, to: null, trace: `ver ${curVer} → 清除` };
  }
  // ── 设置（`--ver <x.y>`）──
  if (!isMilestoneVer(raw)) {
    return {
      ok: false,
      code: "E_M_VER_FORM",
      error: `--ver 需 x.y 形态（如 0.70；现值：${raw}）`,
      hint: "版号归发版账（gd release）；这里只标定存量卡实际占的那条线",
    };
  }
  if (isDevLine) {
    return {
      ok: false,
      code: "E_M_VER_DEVLINE",
      error: `${cur.id} 是开发线卡（新模型）——卡不带版号（两轴模型：版号归发版账）`,
      hint: "存量卡才可标版本号；开发线的活挂线段（如 R-<板>-1a-0）",
    };
  }
  if (legacyRange) {
    return { ok: false, code: "E_M_VER_MIX", error: `${cur.id} 是存量区间卡（ver_from~ver_to）——版号形态不混用` };
  }
  if (curVer === raw) {
    return { ok: true, patch: {}, from: curVer, to: raw, trace: `ver ${curVer}（无变化）`, unchanged: true };
  }
  const holder = (list ?? []).find((m) => String(m.id) !== String(cur.id) && milestoneVersions(m).includes(raw));
  if (holder) {
    return {
      ok: false,
      code: "E_M_VER_OVERLAP",
      error: `版本 ${raw} 已归 ${holder.id}——一个版本号只能归一张里程碑`,
      hint: `先把 ${holder.id} 的版号改掉（gd milestone update ${holder.id} --ver ""）再标到 ${cur.id}`,
    };
  }
  if (cur.status === "reached" && !confirmed) {
    return {
      ok: false,
      code: "E_M_REACHED_VER",
      error: `${cur.id} 已于 ${cur.reached_on ?? "—"} 达成——改它的版号要点名确认`,
      hint: `gd milestone update ${cur.id} --ver ${raw} --confirm ${cur.id}`,
    };
  }
  return { ok: true, patch: { ver: raw }, from: curVer || null, to: raw, trace: `ver ${curVer || "—"} → ${raw}` };
}

/** 列表归一（非数组一律当空账——读侧防御，不改调用方预期） */
const listOf = (list) => (Array.isArray(list) ? list : []);

/** 时间线排序键（`target` 升序 · 同日按 `id`）——排序口径单一实现 */
export const byTimeline = (a, b) =>
  String(a?.target ?? "").localeCompare(String(b?.target ?? "")) || String(a?.id ?? "").localeCompare(String(b?.id ?? ""));

/** 进行中的里程碑 id（时间线顺序；可多张——并行里程碑是允许的） */export function activeMilestoneIds(list) {
  return listOf(list)
    .filter((m) => m && m.status === "in_progress")
    .sort(byTimeline)
    .map((m) => String(m.id ?? ""));
}

/** 需求终态（用于「关联需求 已完成/总数」）：现行为 `done`；`verified` 为 0.14.0 前的历史终态，读旧账时同计完成 */
export const REQ_DONE_STATUSES = new Set(["done", "verified"]);

/** 版本状态的三种取值（**全派生**，不落盘） */
export const VERSION_STATUSES = ["unplanned", "in_progress", "done"];

/**
 * 版本状态派生（0.28.1 R-gm-089）：版本 `x.y` **没有独立实体、不落结版态**，
 *   状态一律由「里程碑区间归属 + 名下需求状态」现算。
 *
 * 口径（三态，不造中间态）：
 *   · `unplanned`   —— 区间给了这个版本，但还没有任何需求挂上来
 *   · `in_progress` —— 挂了需求，还没全完成（含「刚开新子版」与「完成一半」）
 *   · `done`        —— 名下需求全完成（不区分子版是否已结版：子版结版是另一层的事）
 *
 * 里程碑级派生完成度另给 `derived_done`：名下**全部版本都是 done 且至少一个版本有需求** ⇒ true；
 *   没有版号 / 名下一个需求都没有 ⇒ **null**（不知道，不替人下结论）。
 *
 * @param {object} m 里程碑条目（读 `ver`；存量卡读 `ver_from` / `ver_to`）
 * @param {Array<{id?: string, subver?: string, status?: string}>} reqEntries 板上需求条目（`subver` 为 `x.y.z`）
 * @returns {{versions: {version: string, total: number, done: number, status: string, reqs: string[]}[], derived_done: boolean|null, total: number, done: number}}
 */
export function versionProgressOf(m, reqEntries, { doneStatuses = REQ_DONE_STATUSES } = {}) {
  const versions = milestoneVersions(m);
  if (versions.length === 0) return { versions: [], derived_done: null, total: 0, done: 0 };
  const rows = (Array.isArray(reqEntries) ? reqEntries : [])
    .map((r) => ({ id: String(r?.id ?? ""), subver: String(r?.subver ?? "").trim(), status: String(r?.status ?? "") }))
    .filter((r) => /^\d+\.\d+\.\d+$/.test(r.subver)); // 没有子版号的需求不归任何版本（子版号是唯一的归属依据）
  const list = versions.map((version) => {
    const mine = rows.filter((r) => r.subver.split(".").slice(0, 2).join(".") === version);
    const done = mine.filter((r) => doneStatuses.has(r.status)).length;
    const status = mine.length === 0 ? "unplanned" : done === mine.length ? "done" : "in_progress";
    return { version, total: mine.length, done, status, reqs: mine.map((r) => r.id) };
  });
  const total = list.reduce((a, x) => a + x.total, 0);
  const done = list.reduce((a, x) => a + x.done, 0);
  const hasAny = list.some((x) => x.total > 0);
  return { versions: list, derived_done: hasAny ? done === total : null, total, done };
}

/**
 * 版本 → 归属里程碑（单一实现）：一个版本号只能归一张里程碑（重叠由 `validateMilestones` 拦）。
 * @param {object[]} list 里程碑账
 * @param {string} version `x.y`
 * @returns {object|null} 归属条目；无归属 / 形态非法 / 区间外 ⇒ null
 */
export function milestoneOfVersion(list, version) {
  const v = String(version ?? "").trim();
  if (!isMilestoneVer(v)) return null;
  return listOf(list).find((m) => milestoneVersions(m).includes(v)) ?? null;
}

/**
 * 派生视图（**固定时间线顺序 + 逾期 + 关联需求进度 + 汇总**——界面直接照渲染）。
 * 排序（0.15.4 定案修订 2026-10-10）：**一律按 `target` 升序**（同日按 `id`）——固定时间先后，
 * **不按状态分组 / 不因状态变化动态重排**（已达成条目就留在它原来的时间位置上）。
 * @param {object[]} list
 * @param {number} [now]
 * @param {{ reqStatusById?: Record<string,string>|null }} [o] 传入时算 `reqs_done`（需求 id → status）
 * @returns {{ items: object[], summary: { total: number, reached: number, active_ids: string[] } }}
 */
export function milestonesView(list, now = Date.now(), { reqStatusById = null } = {}) {
  const today = dateStrOf(now);
  const items = list.map((m) => {
    const reached = m.status === "reached";
    const overdue = !reached && isMilestoneDate(m.target) && m.target < today;
    const reqs = m.reqs ?? [];
    return {
      ...m,
      // `status` 是账面真值（可多张进行中）；`is_active` 只供界面画标记，不参与任何写侧准入
      is_active: m.status === "in_progress",
      overdue,
      overdue_days: overdue ? dayGap(m.target, today) : 0,
      // 剩余天数（未达成且未逾期时才有意义·首页副题「剩余 N 天」用；页面不再比日期）
      days_left: !reached && !overdue && isMilestoneDate(m.target) ? Math.max(0, dayGap(today, m.target) ?? 0) : 0,
      reqs_total: reqs.length,
      reqs_done: reqStatusById ? reqs.filter((r) => REQ_DONE_STATUSES.has(String(reqStatusById[r] ?? ""))).length : null,
    };
  });
  items.sort(byTimeline);
  const activeIds = items.filter((m) => m.status === "in_progress").map((m) => String(m.id ?? ""));
  return { items, summary: { total: items.length, reached: items.filter((m) => m.status === "reached").length, active_ids: activeIds } };
}

/** 单行标量（含注释符 / 冒号 / 行首引号 / 首尾空格时加引号；读侧 unquoteScalar 归一）
 *  **含换行时必须转义**（→ `\n`）：不加引号的真实换行会把 yaml 结构写断（下一行变成新条目）——
 *  留痕类文本（note 追写）天然会带换行，写侧不能假设“note 永远是单行”。 */
function yamlScalar(v) {
  const s = String(v ?? "");
  if (s === "") return '""';
  if (/[\n\r]/.test(s)) return `"${s.replace(/\\/g, "/").replace(/"/g, "'").replace(/\r?\n/g, "\\n")}"`;
  return /[:#]|^\s|\s$|^["'\-?*&!|>%@`]/.test(s) ? `"${s.replace(/"/g, "'").replace(/\\/g, "/")}"` : s;
}

/** 条目数组 → yaml 文本（写侧唯一出口 · 已知字段有固定顺序，未知键尾随保留） */
export function serializeMilestones(list) {
  const lines = [
    "# gd 里程碑账（项目级）—— 写法见 docs/gd-entry-page-design.md §11；用 `gd milestone` 维护，勿手改格式",
    "milestones:",
  ];
  if (list.length === 0) lines[lines.length - 1] = "milestones: []";
  for (const m of list) {
    lines.push(`  - id: ${yamlScalar(m.id)}`);
    lines.push(`    name: ${yamlScalar(m.name)}`);
    lines.push(`    target: ${yamlScalar(m.target)}`);
    lines.push(`    status: ${yamlScalar(m.status)}`);
    if (m.status === "reached" && m.reached_on) lines.push(`    reached_on: ${yamlScalar(m.reached_on)}`);
    // 版号（**存量卡只读兼容**）：两轴模型下写侧不再产出；老卡的 ver / ver_from / ver_to 照旧落盘。
    if (m.ver) lines.push(`    ver: ${yamlScalar(m.ver)}`);
    if (m.ver_from) lines.push(`    ver_from: ${yamlScalar(m.ver_from)}`);
    if (m.ver_to) lines.push(`    ver_to: ${yamlScalar(m.ver_to)}`);
    if ((m.reqs ?? []).length > 0) lines.push(`    reqs: [${m.reqs.map((r) => yamlScalar(r)).join(", ")}]`);
    // 0.19.0 C5：alias（版本号别名，只供人读检索）——显式落一行（进了 MILESTONE_FIELDS 就不会走下面的「未知字段尾随」）
    if (m.alias) lines.push(`    alias: ${yamlScalar(m.alias)}`);
    if (m.note) lines.push(`    note: ${yamlScalar(m.note)}`);
    for (const k of Object.keys(m)) {
      if (MILESTONE_FIELDS.includes(k) || MILESTONE_LEGACY_FIELDS.includes(k)) continue;
      if (m[k] === undefined || m[k] === null || m[k] === "") continue;
      lines.push(`    ${k}: ${yamlScalar(m[k])}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** 落盘（调用方负责自动提交；空数组也写成合法文件而非删文件） */
export function writeMilestones(projectDir, list) {
  const path = milestonesPathOf(projectDir);
  writeFileSync(path, serializeMilestones(list), "utf8");
  return path;
}

/** `m1` / `m2`… 递增短号（T3 定案：非 slug——改名不失效） */
export function nextMilestoneId(list) {
  // 里程碑 id = `m-{序号}`（0.20.x 起；存量 `m1` / `m2` 参与取最大值，保证不撞号）
  let max = 0;
  for (const m of list) {
    const n = /^m-(\d+)$/.exec(String(m.id ?? "")) ?? /^m(\d+)$/.exec(String(m.id ?? ""));
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `m-${max + 1}`;
}

/**
 * 新模型卡的 id 铸造：`m-<序号><代际字母>`（如 `m-1a`）——**两轴模型**下开发线的 id 形态。
 *
 * 为什么带字母：存量卡是 `m-1` … `m-6`（纯数字）；带字母才能与它们**天然不撞**，
 *   也让「需求 id 第二段 = 线段（`1a`）」与存量版本段（纯数字 `30`）区分得开。
 * 序号在**同一代际内**自增（`m-1a` → `m-2a` → …）；代际字母缺省 `a`。
 * @param {object[]} list 板上的卡
 * @param {string} [series] 代际字母（缺省 a）
 */
export function nextDevMilestoneId(list, series = "a") {
  const s = String(series ?? "a").trim().toLowerCase() || "a";
  const used = new Set((list ?? []).map((m) => String(m?.id ?? "").trim().toLowerCase()));
  let k = 1;
  while (used.has(`m-${k}${s}`)) k += 1;
  return `m-${k}${s}`;
}

/** 按 id 找条目（`--id` 允许省略 `m` 前缀的纯数字写法） */
export function findMilestone(list, id) {
  // 兼容三种写法：完整 id（`m-3` / 存量 `m3`）· 裸序号（`3`）——
  //   迁移期旧账里是 `m3`、新账写 `m-3`，两者应指向同一条（比较时按**序号**归一）。
  // **带代际字母的 id（`m-1a`）例外**：它是个体标识而非序号缩写，只做逐字匹配，
  //   不与 `m-1` 归一（否则 `m-1` 与 `m-1a` 两张卡会互相串）。
  const want = String(id ?? "").trim();
  if (want === "") return null;
  const direct = list.find((m) => String(m.id) === want);
  if (direct) return direct;
  // 带代际字母的写法只认逐字（`m-1a` ≠ `m-1`）：它是个体标识，不是序号缩写
  if (/[a-z]/i.test(want.replace(/^m-?/i, ""))) return null;
  const num = milestoneNo(want);
  if (num === null) return null;
  // 裸序号：**存量纯数字卡优先**（`1` ⇒ `m-1`，歧义最小）；没有纯数字卡时指向同序号唯一那张开发线卡
  //   （新模型板上 `gd milestone progress 1` 仍能命中 `m-1a`，不必逼人打出字母）
  const plain = list.find((m) => devLineSegOf(m) === "" && milestoneNo(m.id) === num);
  if (plain) return plain;
  const dev = list.filter((m) => devLineSegOf(m) !== "" && milestoneNo(m.id) === num);
  return dev.length === 1 ? dev[0] : null;
}

/** id → 序号（`m-3` / `m3` / `3` 都解析成 3；非数字形态返回 null） */
function milestoneNo(id) {
  // 新模型 id（`m-1a`）也带序号：字母后缀是**代际标记**，序号仍是 1 ⇒ `m1` / `1` 照样指得到
  const m = /^(?:m-?)?(\d+)(?:[a-z])?$/.exec(String(id ?? "").trim());
  return m ? Number(m[1]) : null;
}

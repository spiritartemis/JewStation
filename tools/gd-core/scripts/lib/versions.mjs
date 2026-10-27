/**
 * versions 数据层（v）— 需求版本链与补丁账
 * 规范见 docs/verified-req-patch-scheme.md（§2 数据模型 / §4 快捷通道 / §5 re-baseline）
 *
 * 职责：
 *   - 读取/写入版本链账（版本账 + 补丁账 + 登记变更备注）——
 *     账落位随项目迁移：存量项目在 `reqs/<R-id>/versions.yaml`，迁移后并入 `reqs/index.yaml` 的 `versions:` 段
 *     （读侧以后者优先：文件在则读文件，不在则读 index 块——单一实现，不双写）
 *   - 零迁移首写：现存已 verify 需求自动补 v1 条目（tag 用历史别名 <rid>-verified）
 *   - 派生：活跃版本号、活跃版本任务集（revision 字段过滤）
 *   - 需求 revision 字段读取（index.yaml 条目）
 *   - 任务 revision 字段缺省补 1（解析时，不写回）
 *
 * 不在此层负责：补丁判据（lib/patch-rules.mjs，P2）、re-baseline 动作序列（P3）、
 *                状态派生（继续在 lib/reqflow.mjs 派生，此层只提供 currentRevision / activeTaskIds）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseYaml } from "./yaml.mjs";
import { BOARD_SCHEMA_VERSION, readReqIndexBlock, readTaskLedger, upsertReqIndexBlock } from "./board.mjs";

// ── 路径 ──────────────────────────────────────────────────────
/** versions.yaml 路径：<projDir>/reqs/<reqId>/versions.yaml */
export function versionsYamlPathOf(projDir, reqId) {
  return join(projDir, "reqs", reqId, "versions.yaml");
}

/**
 * 【已废弃·2026-09-16 简化】revisions/ 快照目录（<projDir>/reqs/<reqId>/revisions/）。
 * 升版不再冻结快照（快照无法自证未被篡改，且旧版本任务集可由 task-list 的 revision 字段重建）；
 * 保留本函数仅供读取存量目录/回滚参考，新代码不要调用。
 */
export function revisionsDirOf(projDir, reqId) {
  return join(projDir, "reqs", reqId, "revisions");
}

// ── 缺省结构 ──────────────────────────────────────────────────
/** 空 versions.yaml 结构 */
export function emptyVersions(reqId) {
  return {
    req: reqId,
    current: 1,
    versions: [
      {
        n: 1,
        status: "in_progress", // 占位；首调 loadOrMigrateVersions 时按需求条目 status 自动校正
        opened_at: new Date().toISOString(),
      },
    ],
    patches: [],
    registry_changes: [],
  };
}

/** re-baseline 补丁条数阈值的缺省值（§5.1） */
export const DEFAULT_QUOTA_PATCHES = 3;

/**
 * 补丁条数阈值：`versions.yaml` 顶层 `quota_patches` 覆盖，缺省 / 非法 → 3。
 * 额度只按**条数**计（件数仅落账供审计，不参与阈值）。
 * @returns {number}
 */
export function quotaPatchesThreshold(data) {
  const n = Number(data?.quota_patches);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_QUOTA_PATCHES;
}

// ── 读 ────────────────────────────────────────────────────────
/**
 * 版本链账落位（单一判据）：
 *   · `reqs/<R-id>/versions.yaml` 存在 → 存量文件（未迁移项目）；
 *   · 否则任务账已是 v4（已迁两账）→ `reqs/index.yaml` 的 `versions:` 段；
 *   · 否则（旧项目尚未首写）→ 沿用文件形（向后兼容，迁移时并入 index）。
 * @returns {"file"|"index"}
 */
function versionsHome(projDir, reqId) {
  if (existsSync(versionsYamlPathOf(projDir, reqId))) return "file";
  return readTaskLedger(projDir, reqId).schemaVersion >= BOARD_SCHEMA_VERSION ? "index" : "file";
}

/**
 * 读版本链账（落位判据见 versionsHome）。两处皆无返回 null（调用方决定是否触发零迁移）。
 * 解析失败抛错（用户行为：保留原文件待修）。
 */
export function readVersions(projDir, reqId) {
  const p = versionsYamlPathOf(projDir, reqId);
  if (existsSync(p)) return parseYaml(readFileSync(p, "utf8"));
  // 迁移后账在 reqs/index.yaml 的 `versions:` 子块（mergeVersions 把整个 versions.yaml 序列化后写入该块，
  // 所以 `patches:` 与 `registry_changes:` 也嵌套在该子块内——`reqBlockRange` 修过边界后可读到完整数据）。
  const versionsBlock = readReqIndexBlock(projDir, reqId, "versions");
  return versionsBlock ? parseYaml(versionsBlock) : null;
}

// ── 写 ────────────────────────────────────────────────────────
/**
 * 写版本链账（落位与 versionsHome 同判据）。空对象兜底补 req 字段。
 * 写 index 块时剥掉冗余的 `req:` 行（条目内 id 已是需求身份）。
 * @returns {number} 写入字节数（用于 selftest）
 */
export function writeVersions(projDir, reqId, data) {
  if (!data.req) data.req = reqId;
  const text = buildVersionsYaml(data);
  const p = versionsYamlPathOf(projDir, reqId);
  if (versionsHome(projDir, reqId) === "file") {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text, "utf8");
    return Buffer.byteLength(text, "utf8");
  }
  const block = text.replace(/^req:.*\n/m, "").replace(/^\n+/, "");
  upsertReqIndexBlock(projDir, reqId, "versions", block);
  return Buffer.byteLength(block, "utf8");
}

/**
 * 手搓 versions.yaml（与现有 lib/reqflow.mjs 同款极简 YAML 风格）
 * 顶层 6 键（quota_patches 可选，不设即沿用缺省 3）：
 *   req / current / quota_patches / versions / patches / registry_changes
 */
export function buildVersionsYaml(d) {
  const lines = [
    "# 需求版本链与补丁账（v）",
    "# 规范见 docs/verified-req-patch-scheme.md（§2 数据模型）",
    "# 字段顺序：req → current → quota_patches（可选）→ versions → patches → registry_changes",
    "",
    `req: ${d.req}`,
    `current: ${d.current}`,
  ];
  // 补丁条数阈值覆盖（可选；不写 = 缺省 3——零迁移文件不受影响）
  if (d.quota_patches != null) lines.push(`quota_patches: ${quotaPatchesThreshold(d)}`);
  // versions 列表
  lines.push("versions:");
  for (const v of d.versions ?? []) {
    lines.push(`  - n: ${v.n}`);
    lines.push(`    status: ${v.status}`);
    if (v.tag) lines.push(`    tag: ${v.tag}`);
    if (v.verified_at) lines.push(`    verified_at: ${v.verified_at}`);
    if (v.superseded_at) lines.push(`    superseded_at: ${v.superseded_at}`);
    if (v.opened_at) lines.push(`    opened_at: ${v.opened_at}`);
    if (v.reason) lines.push(`    reason: ${quoteYamlScalar(v.reason)}`);
    if (v.baseline) lines.push(`    baseline: ${v.baseline}`);
    if (v.deliverables_hash) lines.push(`    deliverables_hash: ${v.deliverables_hash}`);
    if (Array.isArray(v.patches) && v.patches.length > 0) {
      // 分行写（避免 yaml.mjs 把 inline 数组解析为字符串）
      lines.push("    patches:");
      for (const pid of v.patches) lines.push(`      - ${pid}`);
    }
  }
  // patches 列表
  lines.push("patches:");
  if (!d.patches || d.patches.length === 0) {
    lines.push("  - _placeholder: true    # 占位条目（保证数组语义；真实补丁由 gd patch apply 追加）");
  } else {
    for (const p of realPatches(d)) {
      lines.push(`  - id: ${p.id}`);
      lines.push(`    version: ${p.version}`);
      lines.push(`    level: ${p.level}`);
      lines.push(`    reason: ${quoteYamlScalar(p.reason ?? "")}`);
      if (p.at) lines.push(`    at: ${p.at}`);
      if (p.actor) lines.push(`    actor: ${p.actor}`);
      // 历史字段：授权机制已退役，仅保留对旧账（已落 authorized_by 的补丁）的写回能力
      if (p.authorized_by) lines.push(`    authorized_by: ${quoteYamlScalar(p.authorized_by)}`);
      if (p.commit) lines.push(`    commit: ${p.commit}`);
      // req 归属（多值 / none）— §4 --req 必填（分行写，规避 yaml.mjs 把 inline 数组解析为字符串）
      if (Array.isArray(p.req) && p.req.length > 0) {
        lines.push("    req:");
        for (const r of p.req) lines.push(`      - ${quoteYamlScalar(r)}`);
      }
      if (p.evidence) {
        lines.push(`    evidence:`);
        if (p.evidence.files != null) lines.push(`      files: ${p.evidence.files}`);
        if (p.evidence.units != null) lines.push(`      units: ${p.evidence.units}`);
        if (p.evidence.hash_before) lines.push(`      hash_before: ${p.evidence.hash_before}`);
        if (p.evidence.hash_after) lines.push(`      hash_after: ${p.evidence.hash_after}`);
        // paths 列表（P7：声明路径全量落账——额度计数与事后复核都靠它）
        if (Array.isArray(p.evidence.paths) && p.evidence.paths.length > 0) {
          lines.push(`      paths:`);
          for (const x of p.evidence.paths) lines.push(`        - ${quoteYamlScalar(x)}`);
        }
        // hashes 列表（存量结构补丁账的副本 vs 源映射 + 前后 hash）
        if (Array.isArray(p.evidence.hashes) && p.evidence.hashes.length > 0) {
          lines.push(`      hashes:`);
          for (const h of p.evidence.hashes) {
            lines.push(`        - path: ${quoteYamlScalar(h.path ?? "")}`);
            if (h.src) lines.push(`          src: ${quoteYamlScalar(h.src)}`);
            if (h.src_repo) lines.push(`          src_repo: ${quoteYamlScalar(h.src_repo)}`);
            if (h.hash) lines.push(`          hash: ${quoteYamlScalar(h.hash)}`);
            if (h.hash_before) lines.push(`          hash_before: ${quoteYamlScalar(h.hash_before)}`);
            if (h.hash_after) lines.push(`          hash_after: ${quoteYamlScalar(h.hash_after)}`);
          }
        }
        // file_hashes 列表（P7：erratum 逐文件前后 hash；additive 同用——事后机械化复核的凭据）
        if (Array.isArray(p.evidence.file_hashes) && p.evidence.file_hashes.length > 0) {
          lines.push(`      file_hashes:`);
          for (const h of p.evidence.file_hashes) {
            lines.push(`        - path: ${quoteYamlScalar(h.path ?? "")}`);
            if (h.before) lines.push(`          before: ${quoteYamlScalar(h.before)}`);
            if (h.after) lines.push(`          after: ${quoteYamlScalar(h.after)}`);
          }
        }
        // preserved_paths 列表（additive：声明“旧值全保留”的结论面文件）
        if (Array.isArray(p.evidence.preserved_paths) && p.evidence.preserved_paths.length > 0) {
          lines.push(`      preserved_paths:`);
          for (const x of p.evidence.preserved_paths) lines.push(`        - ${quoteYamlScalar(x)}`);
        }
        // unverifiable_paths 列表（additive：无法机械判定“只增不改”、必须靠件内自证背书的文件）
        if (Array.isArray(p.evidence.unverifiable_paths) && p.evidence.unverifiable_paths.length > 0) {
          lines.push(`      unverifiable_paths:`);
          for (const x of p.evidence.unverifiable_paths) lines.push(`        - ${quoteYamlScalar(x)}`);
        }
        // verify_history 列表（append-only：每次件内自证/补证的结果——cmd + exit + 指纹 + 时间）
        if (Array.isArray(p.evidence.verify_history) && p.evidence.verify_history.length > 0) {
          lines.push(`      verify_history:`);
          for (const h of p.evidence.verify_history) {
            lines.push(`        - at: ${quoteYamlScalar(h.at ?? "")}`);
            lines.push(`          cmd: ${quoteYamlScalar(h.cmd ?? "")}`);
            lines.push(`          status: ${h.status ?? ""}`);
            if (h.actor) lines.push(`          actor: ${quoteYamlScalar(h.actor)}`);
            if (h.source) lines.push(`          source: ${quoteYamlScalar(h.source)}`);
            if (h.files_fingerprint) lines.push(`          files_fingerprint: ${quoteYamlScalar(h.files_fingerprint)}`);
          }
        }
        if (p.evidence.lines_changed != null) lines.push(`      lines_changed: ${p.evidence.lines_changed}`);
        // additive（.x）：“只增不改”声明与证据——旧叶子总量 / 新增叶子量 / 件内自证命令
        if (p.evidence.old_leaves != null) lines.push(`      old_leaves: ${p.evidence.old_leaves}`);
        if (p.evidence.added_leaves != null) lines.push(`      added_leaves: ${p.evidence.added_leaves}`);
        if (p.evidence.verify) {
          lines.push(`      verify: ${quoteYamlScalar(p.evidence.verify)}`);
          if (p.evidence.verify_status != null) lines.push(`      verify_status: ${p.evidence.verify_status}`);
        }
        if (p.evidence.numbers_changed != null) lines.push(`      numbers_changed: ${p.evidence.numbers_changed}`);
        if (p.evidence.params_hash_changed != null) lines.push(`      params_hash_changed: ${p.evidence.params_hash_changed}`);
      }
    }
  }
  // registry_changes 列表
  lines.push("registry_changes:");
  if (realRegistryChanges(d).length === 0) {
    lines.push("  - _placeholder: true    # 占位条目（保证数组语义；真实变更由 gd patch / artifact remove 等追加）");
  } else {
    for (const r of realRegistryChanges(d)) {
      lines.push(`  - at: ${r.at}`);
      lines.push(`    summary: ${quoteYamlScalar(r.summary ?? "")}`);
      if (r.commit) lines.push(`    commit: ${r.commit}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * 过滤 versions.yaml 中"占位条目"（_placeholder: true），返回真实补丁/变更列表。
 * 这是为绕过极简 yaml.mjs（`[]` 解析为 {}）引入的内部约定——只读层透过滤，写层不外露。
 */
export function realPatches(versionsData) {
  const list = versionsData?.patches;
  if (!Array.isArray(list)) return [];
  return list.filter((p) => {
    if (!p || typeof p !== "object") return true;
    const v = p._placeholder;
    // yaml.mjs 把所有标量解析为字符串，"true"/"True"/"1" 都视为占位
    return !(v === true || v === "true" || v === "True" || v === "1");
  });
}
export function realRegistryChanges(versionsData) {
  const list = versionsData?.registry_changes;
  if (!Array.isArray(list)) return [];
  return list.filter((r) => {
    if (!r || typeof r !== "object") return true;
    const v = r._placeholder;
    return !(v === true || v === "true" || v === "True" || v === "1");
  });
}

/** 单行 YAML 标量加引号（含冒号/井号/前导空白时强引；纯简单字串裸值） */
function quoteYamlScalar(v) {
  const s = String(v);
  if (s === "") return '""';
  if (/[:#]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

// ── 零迁移：首写 versions.yaml ────────────────────────────────
/**
 * 零迁移首写：现存需求的 versions.yaml 不存在时，按需求条目状态自动补 v1。
 * - req.status === "verified"（旧态历史别名）/ "done"（4 态终态 = 已验收）→ v1.status=verified，tag=<rid>-verified
 * - req.status === 其他终态前（如 completed） → v1.status 反映当前态
 * - 已存在 versions.yaml → 不动，返回现有
 *
 * 返回 { data, migrated: boolean }
 */
export function loadOrMigrateVersions(projDir, reqId, req) {
  const existing = readVersions(projDir, reqId);
  if (existing) return { data: existing, migrated: false };
  const data = emptyVersions(reqId);
  // v1 派生：按需求条目状态映射
  const v1 = data.versions[0];
  const reqStatus = req?.status ?? "in_progress";
  // 需求态与版本态不是同一套词：需求 `done`（4 态终态 = 已验收）与旧态 `verified` 同义 ⇒ v1 即已验收版本
  if (reqStatus === "verified" || reqStatus === "done") {
    v1.status = "verified";
    v1.tag = `${reqId}-verified`; // 历史别名（§2.4）
    if (req.verified_at) v1.verified_at = req.verified_at;
  } else if (reqStatus === "completed" || reqStatus === "in_progress") {
    v1.status = reqStatus;
    v1.opened_at = req?.created ?? new Date().toISOString().slice(0, 10);
  } else {
    v1.status = reqStatus;
  }
  writeVersions(projDir, reqId, data);
  return { data, migrated: true };
}

// ── 派生：当前活跃版本号 ─────────────────────────────────────
/** 当前活跃版本号（data.current）；缺省视为 1 */
export function currentRevision(versionsData) {
  const v = versionsData?.current;
  if (v == null) return 1;
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * 活跃版本任务 id 集合：revision 字段 == currentRevision 的任务 id。
 * 任务缺省 revision 视为 1（与 §2.3 零迁移一致）。
 * 返回 Set<string>；versionsData 缺省时按 v1 处理。
 */
export function activeTaskIds(versionsData, taskList) {
  const cur = currentRevision(versionsData);
  const out = new Set();
  if (!taskList?.tasks) return out;
  for (const t of taskList.tasks) {
    // yaml.mjs 把 revision 解析为字符串；统一 Number 归一后比对（缺省视为 1）
    if (Number(t.revision ?? 1) === cur) out.add(t.id);
  }
  return out;
}

// ── 需求 revision（index.yaml 条目字段） ────────────────────
// ── 需求 revision（index.yaml 条目字段） ──────────────
/** 读需求 revision（index.yaml 条目字段）；缺省返回 1 */
export function readReqRevision(reqObj) {
  const n = Number(reqObj?.revision ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
// ── vP3 · re-baseline 工具 ──────────────────────────────

/**
 * 深拷贝 versions data（嵌套数组/对象均复制；不改原数据）。
 * 注：原为 revisions/ 快照而设，快照机制已废弃（2026-09-16）——保留为通用工具，升版不再调用。
 */
export function cloneVersions(data) {
  return JSON.parse(JSON.stringify(data ?? {}));
}

/** 当前版本条目（data.versions 里 n === current 的那一条）；缺省返回 v1 默认 */
export function currentVersionEntry(data) {
  const cur = currentRevision(data);
  const list = data?.versions ?? [];
  return list.find((v) => Number(v.n) === Number(cur)) ?? null;
}

/**
 * 单条补丁的额度计费「件数」（§11.4 裁定 8/10）
 *   P7 起：apply 时算好落账 `evidence.units`（`additive` = **件根数**——同一件交付包的多个副本算 1 件；
 *   `erratum` = 变更文件数；存量 `structure` 账为件根数）；旧账（无 units）回退「逐文件路径去重」（hashes.path ∪ paths）。
 *   ⚠ 仅供**审计/展示参考**：件数**不参与** re-baseline 阈值（阈值只按条数，见 §5.1）。
 * @returns {number}
 */
export function patchUnits(p) {
  const n = Number(p?.evidence?.units);
  if (Number.isFinite(n) && n > 0) return n;
  const set = new Set();
  for (const h of p?.evidence?.hashes ?? []) if (h.path) set.add(h.path);
  for (const x of p?.evidence?.paths ?? []) set.add(x);
  return set.size;
}

/**
 * 计算当前版本的 L0 补丁额度（§5.1：阈值**只按条数**，件数仅落账不参与）
 * @returns {{patches:number, units:number, threshold_patches:number, hit:boolean, hits:string[]}}
 *   units = 当前版本累计计费件数（审计参考，**不参与阈值**）
 */
export function patchQuota(data) {
  const cur = currentRevision(data);
  const curPatches = realPatches(data).filter((p) => Number(p.version) === Number(cur));
  let units = 0;
  for (const p of curPatches) units += patchUnits(p);
  const T_PATCHES = quotaPatchesThreshold(data);
  const hits = [];
  if (curPatches.length >= T_PATCHES) hits.push(`patches≥${T_PATCHES}`);
  return {
    patches: curPatches.length,
    units,
    threshold_patches: T_PATCHES,
    hit: hits.length > 0,
    hits,
  };
}

/**
 * 标记指定版本为 superseded（旧 tag 保留作锚点；不动 tag 字符串）。
 */
export function supersedeVersion(data, n, { supersededAt } = {}) {
  const list = data?.versions ?? [];
  const v = list.find((x) => Number(x.n) === Number(n));
  if (!v) return false;
  v.status = "superseded";
  v.superseded_at = supersededAt ?? new Date().toISOString();
  return true;
}

/**
 * 追加新版本条目（in_progress 起点；reason / openedAt 必填）。
 * 不改 current —— 由调用方在 snapshot 写盘后改。
 */
export function appendVersion(data, { reason, openedAt }) {
  const list = data?.versions ?? [];
  const nextN = list.length === 0 ? 1 : Math.max(...list.map((v) => Number(v.n))) + 1;
  const v = {
    n: nextN,
    status: "in_progress",
    opened_at: openedAt ?? new Date().toISOString(),
    reason: reason ?? null,
    patches: [],
  };
  list.push(v);
  return v;
}

/**
 * 版本验收 tag 名（§2.4）：v1 = 历史别名 `<rid>-verified`；v2+ = `<rid>-v<N>-verified`。
 * 用于补丁账引用 / 下游声明「基于 R-xxx @ vN」；`<rid>-verified` 为版本账历史别名（tag 需手工 `gd git tag` 打）。
 */
export function versionTagName(reqId, n) {
  const num = Number(n) || 1;
  return num === 1 ? `${reqId}-verified` : `${reqId}-v${num}-verified`;
}

/** re-baseline 标记旧基线终点的 tag 名（可选，§2.4；当前无生产调用，保留 API 供下游声明） */
export function supersededTagName(reqId, n) {
  return `${reqId}-v${Number(n) || 1}-superseded`;
}

/**
 * 版本状态 → 界面人话（C1）。
 * **数据字段名不动**（`versions.yaml` 仍写 `superseded` 等），仅展示层翻译。
 * 与 `.pi/extensions/gd-shared/version-chain.ts` `versionStatusLabel` **同口径**（双实现，改一改二）。
 * 只在「需要时查看」的诊断入口（`gd req status` 等）使用；面板主视图不显 status。
 */
export function versionStatusLabel(status) {
  switch (status) {
    case "superseded": return "旧版";
    case "in_progress": return "活跃";
    case "verified": return "已验收";
    case "completed": return "待验收";
    default: return status;
  }
}

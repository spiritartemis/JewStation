/**
 * 发版账（releases）—— **对外版本坐标**（两轴模型的发布轴）
 *
 * 背景：版本号从「里程碑的附属坐标」里独立出来，成为**对外发布的坐标**——
 *   内部怎么排（开发线 / 开发序号）与对外发什么版（0.70）本就是两件事。
 *   于是版本号归发版流程管：一条 release = 一个对外版本 + 收进这条版本的需求集合。
 *
 * 落点：`<板根>/releases.yaml`（板级小账，与 `reqs/index.yaml` / `milestones.yaml` / `lines.yaml` 解耦）：
 *   releases:
 *     - version: "0.70"        # 对外版本号 x.y
 *       status: draft           # draft | frozen | tagged（人的宣告，逐级推进）
 *       reqs: [R-gm-1a-0]       # 收进这条版本的需求（**多对多**：同一需求可出现在多条 release 里 = backport）
 *       tag: ""                 # tagged 后记的 git tag
 *       evidence: ""            # 冻结前的回归 / 验收证据
 *       note: ""
 *       created: 2026-10-27
 *
 * 语义：
 *   · **draft**  = 正在挑需求（成员可增删）
 *   · **frozen** = 冻结（成员锁定；要改先解冻；冻结前必须带回归证据）
 *   · **tagged** = 已打 tag（对外版本成立；此后只读）
 *   · 版本号**递增口径**：缺省给「既有 release 的下一个可用号」（x.y 数值序 max+1）；显式给则校验不撞号。
 *   · 缺陷的 `found_in` / `affects` 指向这里的版本（对外坐标）；需求不再挂版本号（那是发布轴的事，由 release 成员表记）。
 *
 * 存量兼容：老账里以「版本号」组织的子版结版事实（`subvers.yaml`）**只读**保留——那是旧模型的历史，不迁。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml, unquoteScalar } from "./yaml.mjs";

export const RELEASES_FILE = "releases.yaml";

/** 对外版本号形态：`x.y`（**版本线**）或 `x.y.z`（对外发版的具体版本）
 *
 *  为什么两段三段都收（B-gm-000065）：`x.y` 是**版本线**（并行隔离 + blocker 门禁的坐标），
 *  `x.y.z` 才是真正发出去的那个版本。旧实现只认 `x.y`，结果分包号（0.70.6）无处可登记，
 *  只能去旧模型的子版池里造假——那是拿旧手续给新模型擦屁股。
 *  兼容：存量 `x.y` 记录一字不动，读侧按 `x.y.0` 参与比较。
 */
export const RELEASE_VERSION_RE = /^\d+\.\d+(?:\.\d+)?$/;

/** release 三态（人的宣告，逐级推进） */
export const RELEASE_STATUSES = ["draft", "frozen", "tagged"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 版本号形态校验 */
export function isReleaseVersion(v) {
  return RELEASE_VERSION_RE.test(String(v ?? "").trim());
}

/** `x.y` / `x.y.z` → 三段数字（不足补 0；非形态返回 null） */
export function releaseVersionParts(v) {
  const raw = String(v ?? "").trim();
  if (!RELEASE_VERSION_RE.test(raw)) return null;
  const parts = raw.split(".").map(Number);
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
}

/** 版本线 = 前两段（`0.70.6` → `0.70`）——并行隔离与 blocker 门禁都按**线**判 */
export function releaseLineOf(v) {
  const p = releaseVersionParts(v);
  return p ? `${p[0]}.${p[1]}` : "";
}

/** 版本号数值序比较（非形态按 0 处理，调用方先校验形态） */
export function compareReleaseVersion(a, b) {
  const pa = releaseVersionParts(a);
  const pb = releaseVersionParts(b);
  if (!pa || !pb) return 0;
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

export function releasesPathOf(boardRoot) {
  return join(boardRoot, RELEASES_FILE);
}

const asText = (v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return "";
  return unquoteScalar(String(v));
};
const asList = (v) => {
  if (Array.isArray(v)) return v.map((x) => asText(x)).filter((x) => x !== "");
  const s = asText(v);
  return s === "" ? [] : s.split(",").map((x) => x.trim()).filter(Boolean);
};

/**
 * 读发版账。
 * @returns {{ok: boolean, exists: boolean, path: string, list: object[], error: string|null}}
 */
export function readReleases(boardRoot) {
  const path = releasesPathOf(boardRoot);
  if (!existsSync(path)) return { ok: true, exists: false, path, list: [], error: null };
  let doc;
  try {
    doc = parseYaml(readFileSync(path, "utf8")) ?? {};
  } catch (e) {
    return { ok: true, exists: false, path, list: [], error: `解析失败：${e?.message ?? e}` };
  }
  const raw = Array.isArray(doc.releases) ? doc.releases : [];
  const list = raw
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      version: asText(x.version),
      status: asText(x.status) || "draft",
      reqs: asList(x.reqs),
      tag: asText(x.tag),
      evidence: asText(x.evidence),
      note: asText(x.note),
      created: asText(x.created),
      frozen_on: asText(x.frozen_on),
      tagged_on: asText(x.tagged_on),
    }))
    .filter((x) => x.version);
  return { ok: true, exists: true, path, list, error: null };
}

/** 校验条目（形态 / 状态 / 重复版本号）——CLI 写前闸门与契约检查共用 */
export function validateReleases(list) {
  const errors = [];
  const seen = new Set();
  for (const r of list ?? []) {
    const version = String(r?.version ?? "").trim();
    if (!isReleaseVersion(version)) {
      errors.push({ code: "E_R_VER", version, msg: `版本号形态非法：${version || "（空）"}（应为 x.y 或 x.y.z，如 0.70 / 0.70.6）` });
    } else if (seen.has(version)) {
      errors.push({ code: "E_R_DUP", version, msg: `版本号重复：${version}` });
    } else {
      seen.add(version);
    }
    if (!RELEASE_STATUSES.includes(String(r?.status ?? ""))) {
      errors.push({ code: "E_R_STATUS", version, msg: `status 取值非法：${r?.status ?? "空"}（合法：${RELEASE_STATUSES.join(" | ")}）` });
    }
    if (r?.status === "tagged" && !String(r?.tag ?? "").trim()) {
      errors.push({ code: "E_R_TAG", version, msg: "status: tagged 时 `tag` 必填" });
    }
    if (r?.frozen_on && !DATE_RE.test(String(r.frozen_on))) {
      errors.push({ code: "E_R_DATE", version, msg: "`frozen_on` 必须是 YYYY-MM-DD" });
    }
    if (r?.tagged_on && !DATE_RE.test(String(r.tagged_on))) {
      errors.push({ code: "E_R_DATE", version, msg: "`tagged_on` 必须是 YYYY-MM-DD" });
    }
  }
  return errors;
}

/** 单行标量（含注释符 / 冒号 / 首尾空格时加引号） */
function yamlScalar(v) {
  const s = String(v ?? "");
  if (s === "") return '""';
  return /[:#]|^\s|\s$|^["'\-?*&!|>%@`]/.test(s) ? `"${s.replace(/"/g, "'").replace(/\\/g, "/")}"` : s;
}

/** 序列化（版本号升序；字段顺序固定） */
export function serializeReleases(list) {
  const sorted = [...(list ?? [])].sort((a, b) => compareReleaseVersion(a?.version, b?.version));
  const lines = [
    "# gd 发版账（板级）—— 对外版本坐标：版本 ↔ 需求成员 ↔ draft/frozen/tagged",
    "# 写法见 entry/workflow/protocol.md §3.6；用 `gd release` 维护，勿手改格式",
    "releases:",
  ];
  if (sorted.length === 0) lines[lines.length - 1] = "releases: []";
  for (const r of sorted) {
    lines.push(`  - version: ${yamlScalar(r.version)}`);
    lines.push(`    status: ${yamlScalar(r.status ?? "draft")}`);
    if ((r.reqs ?? []).length > 0) lines.push(`    reqs: [${(r.reqs ?? []).map((x) => yamlScalar(x)).join(", ")}]`);
    if (r.evidence) lines.push(`    evidence: ${yamlScalar(r.evidence)}`);
    if (r.tag) lines.push(`    tag: ${yamlScalar(r.tag)}`);
    if (r.frozen_on) lines.push(`    frozen_on: ${yamlScalar(r.frozen_on)}`);
    if (r.tagged_on) lines.push(`    tagged_on: ${yamlScalar(r.tagged_on)}`);
    if (r.note) lines.push(`    note: ${yamlScalar(r.note)}`);
    if (r.created) lines.push(`    created: ${yamlScalar(r.created)}`);
  }
  return lines.join("\n") + "\n";
}

/** 落盘 */
export function writeReleases(boardRoot, list) {
  const path = releasesPathOf(boardRoot);
  writeFileSync(path, serializeReleases(list), "utf8");
  return path;
}

/** 按版本号找 release */
export function findRelease(list, version) {
  const want = String(version ?? "").trim();
  if (want === "") return null;
  return (list ?? []).find((r) => String(r?.version ?? "") === want) ?? null;
}

/** 下一个可用版本号：**同线 patch + 1**（无既有 ⇒ `0.1.0`）
 *
 *  为什么是 patch+1 而不是 x.y+1（B-gm-000065）：`x.y` 是**对外版本线**，
 *  一条线里可能分多次包（同一条线上连续修 / 连续发）。按 x.y+1 递增的话，每分一次包就
 *  「新开一条线」，线语义被稀释，blocker 门禁按线判也跟着失准。
 */
export function nextReleaseVersion(list) {
  let best = null;
  for (const r of list ?? []) {
    const v = String(r?.version ?? "").trim();
    if (!isReleaseVersion(v)) continue;
    if (best === null || compareReleaseVersion(v, best) > 0) best = v;
  }
  if (best === null) return "0.1.0";
  const [major, minor, patch] = releaseVersionParts(best);
  return `${major}.${minor}.${patch + 1}`;
}

/** 派生视图（给 CLI / 站点直接渲染） */
export function releasesView(list, { reqStatusById = null } = {}) {
  const items = (list ?? []).map((r) => {
    const reqs = r.reqs ?? [];
    return {
      ...r,
      reqs_total: reqs.length,
      reqs_done: reqStatusById ? reqs.filter((x) => ["done", "verified"].includes(String(reqStatusById[x] ?? ""))).length : null,
    };
  });
  items.sort((a, b) => compareReleaseVersion(a.version, b.version));
  return {
    items,
    summary: {
      total: items.length,
      draft: items.filter((r) => r.status === "draft").length,
      frozen: items.filter((r) => r.status === "frozen").length,
      tagged: items.filter((r) => r.status === "tagged").length,
    },
  };
}

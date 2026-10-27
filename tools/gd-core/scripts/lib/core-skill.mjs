/**
 * core skill —— 随包分发的**会话工作法**（渐进注入版 · 0.23.1 R-gm-075 · 0.49.1 多 skill 化）
 *
 * 为什么不再用「guide 整份注入」：旧做法把 145 行 SOP 一次性写进宿主 `AGENTS.md`，
 *   常驻上下文、改动要重跑、内容一旧就误导；而且写进去的是快照，没法按需取舍。
 *   现在改成 **Agent Skill**：`SKILL.md` 只做路由（何时用 + 铁律 + 读哪份），细则落 `references/`，
 *   宿主按触发条件加载、需要时再读引用件——即「渐进披露」。
 *
 * 为什么改成**表**（0.49.1）：原先硬编码单个 `skills/gd-core`，装不下第二个 skill。
 *   现在多份 skill 各自独立（`gd-core` = 板三层账的操作 + 进度查询与播报；`gd-qa` = 人工验收跑测），
 *   装的时候按表遍历——**加一份 skill = 表里加一行**，装配 / 安装 / 自检全部自动跟上。
 *
 * 分发形态：`skills/<name>/**` 与闭包一起随包铺出（`scripts/core-pack.mjs` 遍历本表）；
 *   安装到宿主：`gd-core skill install` → `<仓根>/.pi/skills/<name>/`（项目级，随仓库走、可提交、可共享）。
 *
 * 依赖方向：core（只做文件复制与读盘，无宿主依赖）。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 仓根（`scripts/lib/` 往上两级）；装配件里同构（`<pkg>/scripts/lib/`） */
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * 随包分发的 skill 表（**单一事实源**）。
 *   `primary` = 历史默认（`gd-core skill install` 的老行为指向它，兼容旧调用点与旧断言）。
 *   新加一份 skill：这里加一行 + 建 `skills/<name>/SKILL.md`（含 name/description frontmatter）。
 */
export const SKILLS = Object.freeze([
  { name: "gd-core", rel: "skills/gd-core", install: ".pi/skills/gd-core", primary: true },
  { name: "gd-qa", rel: "skills/gd-qa", install: ".pi/skills/gd-qa" },
]);

/**
 * 已并入的旧 skill 名 → 现役名（`gd-workflow` 的读侧 SOP 并入 `gd-core` 的 `references/status.md`）。
 *   旧名**仍可用**（`gd skill install --skill gd-workflow` 解析到 `gd-core`），但只提示、不再单独分发——
 *   两份读侧 SOP 同时在场 = 同一口径有两套入口，必分叉。
 */
export const LEGACY_SKILLS = Object.freeze({ "gd-workflow": "gd-core" });

/** 旧名归一：旧名 → 现役名；未知名原样返回（由调用方报错，不静默回落） */
export function canonicalSkillName(name) {
  const raw = String(name ?? "");
  return LEGACY_SKILLS[raw] ?? raw;
}

/** 主 skill 名（兼容旧导出：`SKILL_NAME` / `SKILL_SOURCE_REL` / `SKILL_INSTALL_REL`） */
export const SKILL_NAME = SKILLS.find((s) => s.primary)?.name ?? SKILLS[0].name;
/** 主 skill 源目录（相对仓根 / 包根） */
export const SKILL_SOURCE_REL = SKILLS.find((s) => s.primary)?.rel ?? SKILLS[0].rel;
/** 主 skill 装到宿主时的相对路径（项目级 skill） */
export const SKILL_INSTALL_REL = SKILLS.find((s) => s.primary)?.install ?? SKILLS[0].install;

/** 按名字取表项；未知名字返回 null（调用方报错，不静默回落）。旧名先归一（已并入的指向现役那一份） */
export function skillEntry(name) {
  const n = canonicalSkillName(name);
  return SKILLS.find((s) => s.name === n) ?? null;
}

/** 全部 skill 名 */
export function skillNames() {
  return SKILLS.map((s) => s.name);
}

/** 某份 skill 的源目录绝对路径（缺省 = 主 skill） */
export function skillSourceDir(name = SKILL_NAME) {
  const e = skillEntry(name);
  return join(ROOT, e?.rel ?? SKILL_SOURCE_REL);
}

/** 目录下全部文件（相对该目录，正斜杠，排序）：供「真源 ↔ 副本」两边共用同一个 walker */
function listFilesUnder(base) {
  if (!existsSync(base)) return [];
  const out = [];
  const walk = (dir, prefix = "") => {
    for (const n of readdirSync(dir).sort()) {
      const abs = join(dir, n);
      if (statSync(abs).isDirectory()) walk(abs, `${prefix}${n}/`);
      else out.push(`${prefix}${n}`);
    }
  };
  walk(base);
  return out;
}

/** 某份 skill 的源目录下全部文件（相对 SKILL 目录，正斜杠，排序）：SKILL.md + references/*.md */
export function skillFiles(name = SKILL_NAME) {
  return listFilesUnder(skillSourceDir(name));
}

/**
 * 真源与副本逐字节比对（B-gm-000062）——**单一实现**，两处调用：
 *   · `installSkill` 的「幂等跳过 / 冲突拒绝」判据；
 *   · 门禁 `contract check --scope docs` 的「副本是否落后于真源」。
 *
 * 为什么值得提出来（实测）：`skills/<name>/` 是真源、`.pi/skills/<name>/` 是安装产物，两者之间原本**没有任何门禁**。
 *   于是副本会长期停在旧口径（`req new --ver` vs 真源 `--line`），而 `docs` 档只扫示例命令、扫不出「整份落后」这件事——
 *   门禁一路绿，人照着旧副本敲命令才发现不对。**「绿着漂」比红更贵。**
 *
 * 三态（不许糊成两态）：
 *   · `absent` —— 目标目录不存在 = **没装**（不是矛盾；`gd skill install` 之后此档才有意义）；
 *   · `same`   —— 真源里每个文件都存在且逐字节一致（目标里**多出**的文件不判：那是人的地盘）；
 *   · `drift`  —— 有文件不一致或读不到（缺文件按不一致算——「读不到」不等于「一致」）。
 *
 * @param {string} name skill 名（旧名先归一）
 * @param {{root?: string}} [opts] root = 仓根（门禁要按被检查的那个仓算，不能用模块自身的 ROOT）
 */
export function skillCopyState(name, { root = ROOT } = {}) {
  const e = skillEntry(name);
  if (!e) return { name, rel: "", install: "", state: "absent", files: [], diffs: [] };
  const src = join(root, e.rel);
  const dst = join(root, e.install);
  const files = listFilesUnder(src);
  if (!existsSync(dst)) return { name, rel: e.rel, install: e.install, state: "absent", files, diffs: [] };
  const diffs = compareSkillFiles(src, dst, files);
  return { name, rel: e.rel, install: e.install, state: diffs.length > 0 ? "drift" : "same", files, diffs };
}

/**
 * 逐文件比对两个目录（`files` 是相对路径清单）——返回**不一致的文件**（空数组 = 完全一致）。
 * 缺文件 / 读失败都算不一致：判据是「副本能不能顶替真源」，读不到就顶替不了。
 */
export function compareSkillFiles(srcDir, dstDir, files) {
  const diffs = [];
  for (const rel of files) {
    try {
      if (readFileSync(join(dstDir, rel), "utf8") !== readFileSync(join(srcDir, rel), "utf8")) diffs.push(rel);
    } catch {
      diffs.push(rel);
    }
  }
  return diffs;
}

/** 某份 skill 的 SKILL.md 正文（`gd-core skill print` 用；人看 / 手抄给不支持 skill 的宿主） */
export function skillText(name = SKILL_NAME) {
  const p = join(skillSourceDir(name), "SKILL.md");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

/**
 * 把**一份** skill 铺到宿主目录。
 *
 * 目标已存在时（0.49.1 修正）：**先比内容**，不是先报错。
 *   旧行为“存在即拒”在多 skill 下变成死锁——已装过 `gd-core` 的宿主永远加装不上 `gd-qa`
 *   （缺省装全部时第一份就失败 ⇒ 整批不装）。而现在：内容一致 ⇒ 幂等跳过；有差异 ⇒ 才拒（提示 --force）。
 *   “存在”与“冲突”不是同一件事——这是典型的“先验形态，再判对错”。
 * @param {string} targetDir 目标目录（绝对路径）
 * @param {{force?: boolean, name?: string}} [opts]
 */
export function installSkill(targetDir, { force = false, name = SKILL_NAME } = {}) {
  const files = skillFiles(name);
  if (!files.length) return { ok: false, name, error: `skill 源缺失：${skillEntry(name)?.rel ?? name}（装配漏件？）` };
  const dir = String(targetDir);
  const src = skillSourceDir(name);
  if (existsSync(dir)) {
    // 判据与门禁同源（B-gm-000062）：`compareSkillFiles` 一份实现，install 与 `contract check --scope docs` 共用
    const diffs = compareSkillFiles(src, dir, files);
    // 幂等：内容完全一致 ⇒ 不算冲突（目标里多出的其他文件也不管，那是人的地盘）
    if (diffs.length === 0) return { ok: true, name, path: dir.split("\\").join("/"), files, skipped: true };
    if (!force) {
      const shown = diffs.slice(0, 5).join(" · ");
      const more = diffs.length > 5 ? ` 等 ${diffs.length} 个` : "";
      return { ok: false, name, error: `目标已存在且内容与源不同：${dir}（差异：${shown}${more}；重装请加 --force；人改过的副本不会被静默覆盖）`, exists: true, diffs };
    }
    rmSync(dir, { recursive: true, force: true });
  }
  for (const rel of files) {
    const dst = join(dir, rel);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(join(src, rel), dst);
  }
  return { ok: true, name, path: dir.split("\\").join("/"), files };
}

/**
 * 把**多份** skill 铺到宿主根（缺省 = 表里全部）。
 * @param {string} hostRoot 宿主仓根
 * @param {{force?: boolean, names?: string[], relocate?: (rel: string) => string}} [opts]
 * @returns {{ok: boolean, installed: object[], failed: object[]}}
 */
export function installSkills(hostRoot, { force = false, names = skillNames(), relocate = null } = {}) {
  const installed = [];
  const failed = [];
  for (const name of names) {
    const e = skillEntry(name);
    if (!e) {
      failed.push({ name, error: `未知 skill："${name}"（可用：${skillNames().join(" / ")}）` });
      continue;
    }
    const rel = relocate ? relocate(e.install) : e.install;
    const r = installSkill(join(hostRoot, rel), { force, name });
    (r.ok ? installed : failed).push(r.ok ? { name, path: r.path, files: r.files, skipped: r.skipped === true } : { name, error: r.error });
  }
  return { ok: failed.length === 0, installed, failed };
}

/**
 * frontmatter 校验（e2e 与 install 前的自检共用）：name / description 是宿主路由的依据，缺了 skill 等于不存在。
 * @param {string} name skill 名（缺省 = 主 skill）
 */
export function validateSkill(name = SKILL_NAME) {
  const canon = canonicalSkillName(name);
  const text = skillText(canon);
  const rel = skillEntry(canon)?.rel ?? SKILL_SOURCE_REL;
  const problems = [];
  if (!text) return { ok: false, name, problems: [`缺 ${rel}/SKILL.md`] };
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) problems.push("缺 frontmatter（--- 包围的 name / description）");
  const fm = m ? m[1] : "";
  const fmName = (fm.match(/^name:\s*(.+)$/m) ?? [, ""])[1].trim();
  const description = (fm.match(/^description:\s*(.+)$/m) ?? [, ""])[1].trim();
  if (!fmName) problems.push("frontmatter 缺 name");
  else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fmName)) problems.push(`name 非法："${fmName}"（要小写连字符）`);
  else if (fmName !== canon) problems.push(`name 与目录名不一致："${fmName}" ≠ ${canon}`);
  if (!description) problems.push("frontmatter 缺 description（没有它宿主不会加载）");
  else if (description.length > 1024) problems.push(`description 超长（${description.length} > 1024）`);
  // 引用件必须真实存在（写错文件名等于断链）
  for (const ref of text.matchAll(/references\/([A-Za-z0-9._-]+\.md)/g)) {
    if (!existsSync(join(skillSourceDir(canon), "references", ref[1]))) problems.push(`SKILL.md 引用了不存在的 references/${ref[1]}`);
  }
  return { ok: problems.length === 0, name: canon, problems, description, files: skillFiles(canon) };
}

/** 表里每份 skill 的自检结果（install 前一次性把关：一份坏就不装） */
export function validateSkills(names = skillNames()) {
  const results = names.map((n) => {
    if (!skillEntry(n)) return { ok: false, name: n, problems: [`未知 skill："${n}"（可用：${skillNames().join(" / ")}）`] };
    return validateSkill(n);
  });
  return { ok: results.every((r) => r.ok), results, problems: results.flatMap((r) => r.problems.map((p) => `[${r.name}] ${p}`)) };
}

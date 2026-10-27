/**
 * `gd (core) skill` —— 会话工作法的安装与查看（0.23.1 R-gm-075 · core 层 · 0.49.1 多 skill 化）
 *
 * 取代旧的 `gd core guide`（打印 / --write 板根 / --into 注入宿主）：
 *   SOP 现在是一份 **Agent Skill**（`skills/<name>/SKILL.md` + `references/`），由宿主按需加载；
 *   本族只回答三件事——**装到哪、装好了吗、内容长什么样**：
 *
 *   install [--dir <目录>] [--force] [--skill <名字>]   铺到 `<仓根>/.pi/skills/<name>`（缺省装**全部**）
 *   path [--skill <名字>]                              打印源目录 / 目标目录 / 件数（诊断与脚本用）
 *   print [--skill <名字>]                             打印 SKILL.md（不支持 skill 的宿主可手抄；也便于人看）
 *
 * 为什么不再往 `AGENTS.md` 注入：注入是快照，越写越旧；skill 是"按需加载 + 单一事实源在包里"。
 *   早先注入过的 `<!-- gd:workflow:begin -->` 大块，install 时检测到只**提示**、不自动删（人写的文件别替他做主）。
 *
 * 为什么缺省装全部（0.49.1）：拿到包就会用——`gd-core` 是会话工作法主件（写侧 + 读侧），
 *   `gd-qa` 是人工验收跑测；只装一半等于把另一半白装。要只装一份用 `--skill <名字>`。
 *
 * 旧名兼容（gd-workflow 已并入 gd-core）：`--skill gd-workflow` 仍解析到 `gd-core` 并提示——
 *   旧名不是「未知 skill」，突然拒会把还在用旧名的宿主直接卡死。
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { resolveBoard } from "./lib/board-resolve.mjs";
import { errOut, out } from "./lib/style.mjs";
import { LEGACY_SKILLS, SKILL_NAME, SKILLS, canonicalSkillName, installSkill, installSkills, skillEntry, skillFiles, skillNames, skillSourceDir, skillText, validateSkill, validateSkills } from "./lib/core-skill.mjs";

export const SKILL_SUBCOMMANDS = ["install", "path", "print"];

export const SKILL_FLAGS = ["--dir", "--force", "--json", "--skill"];

export const SKILL_USAGE = [
  "用法：",
  "  gd-core skill install [--dir <目录>] [--force] [--skill <名字>] [--json]   # 缺省装全部；--dir = 装到该目录下",
  "  gd-core skill path [--skill <名字>] [--json]                              # 源目录 / 目标目录 / 件数",
  "  gd-core skill print [--skill <名字>] [--json]                             # 打印 SKILL.md（不支持 skill 的宿主可手抄）",
  `  可选 skill：${SKILLS.map((s) => s.name).join(" / ")}`,
].join("\n");

/** 宿主仓根：板在就取 `board.repo`（skill 要装到宿主读的位置），否则当前目录 */
function hostRoot() {
  const rb = resolveBoard({ cwd: process.cwd() });
  const repo = rb.board && !rb.board.error ? String(rb.board.repo ?? "").trim() : "";
  return repo || process.cwd();
}

const printPlan = (lines) => lines.forEach((l) => console.log(l));

/** 要装到哪：`--dir` 显式目录（相对 cwd），缺省 = 宿主仓根下的 `.pi/skills/<name>` */
function targetDirOf(dir, name = SKILL_NAME) {
  const rel = skillEntry(name)?.install ?? SKILLS[0].install;
  if (dir) {
    const base = isAbsolute(dir) ? dir : join(process.cwd(), dir);
    // `--dir` 装单份时直接铺到该目录；装全部时铺到 `<dir>/<name>`（否则两份会互相覆盖）
    return { base, single: base, multi: join(base, name) };
  }
  return { base: null, single: join(hostRoot(), rel), multi: null };
}

function rejectUnknown(args, allowed) {
  const known = new Set(allowed);
  const bad = Object.keys(args).filter((k) => !known.has(`--${k}`));
  if (bad.length) {
    console.error(errOut.err(`✗ 未知参数：${bad.map((b) => `--${b}`).join(" ")}（skill 接受：${allowed.join(" ")}）`));
    console.error(SKILL_USAGE);
    return true;
  }
  return false;
}

export function runSkill(sub, rest = []) {
  const args = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--force") args.force = true;
    else if (a === "--json") args.json = true;
    else if (a === "--dir") args.dir = rest[++i];
    else if (a.startsWith("--dir=")) args.dir = a.slice(6);
    else if (a === "--skill") args.skill = rest[++i];
    else if (a.startsWith("--skill=")) args.skill = a.slice(8);
    else args[a.replace(/^--/, "")] = true;
  }
  if (rejectUnknown(args, SKILL_FLAGS)) return 1;
  const json = args.json === true;
  const subName = String(sub ?? "");
  // `--skill` 给了就只针对那一份；没给 = 全部（install）/ 主 skill（path / print）
  const onlyRaw = typeof args.skill === "string" ? String(args.skill) : null;
  const legacy = onlyRaw ? LEGACY_SKILLS[onlyRaw] : null;
  const only = onlyRaw ? canonicalSkillName(onlyRaw) : null;
  if (legacy) {
    console.error(out.warn(`⚠ skill "${onlyRaw}" 已并入 "${legacy}"（读侧 SOP 收进 gd-core/references/status.md）——按 "${legacy}" 处理`));
  }
  if (only && !skillEntry(only)) {
    console.error(errOut.err(`✗ 未知 skill "${onlyRaw}"（可用：${skillNames().join(" / ")}）`));
    return 1;
  }
  const wanted = only ? [only] : skillNames();

  if (subName === "path") {
    const dirs = targetDirOf(args.dir, only ?? SKILL_NAME);
    const rows = wanted.map((n) => {
      const files = skillFiles(n);
      const target = wanted.length > 1 ? (dirs.base ? join(dirs.base, n) : join(hostRoot(), skillEntry(n).install)) : dirs.single;
      return {
        name: n,
        source: skillSourceDir(n).split("\\").join("/"),
        sourceRel: skillEntry(n).rel,
        target: target.split("\\").join("/"),
        installed: existsSync(join(target, "SKILL.md")),
        files,
      };
    });
    const ok = rows.every((r) => r.files.length > 0);
    if (json) {
      console.log(JSON.stringify({ ok, skills: rows }, null, 2));
      return ok ? 0 : 1;
    }
    const plan = [];
    for (const r of rows) {
      plan.push(`${out.dim(`[${r.name}] skill 源`)}：${r.source}（${r.files.length} 个文件）`);
      plan.push(`${out.dim(`[${r.name}] 装到哪`)}：${r.target}${r.installed ? out.dim("（已安装）") : ""}`);
    }
    printPlan(plan);
    if (!ok) console.error(errOut.err(`  · 源缺失：${rows.filter((r) => !r.files.length).map((r) => r.sourceRel).join(" / ")} 没随包铺出（装配漏件）`));
    return ok ? 0 : 1;
  }

  if (subName === "print") {
    const name = only ?? SKILL_NAME;
    const v = validateSkill(name);
    const text = skillText(name);
    if (json) {
      console.log(JSON.stringify({ ok: v.ok, name, problems: v.problems, text }, null, 2));
      return v.ok ? 0 : 1;
    }
    if (!text) {
      console.error(errOut.err(`✗ 缺 ${skillEntry(name)?.rel ?? name}/SKILL.md`));
      return 1;
    }
    console.log(text);
    if (!v.ok) console.error(errOut.err(`✗ skill 自检未过：${v.problems.join(" · ")}`));
    return v.ok ? 0 : 1;
  }

  if (subName === "install") {
    // 一次把关全部（要装的每一份都得合法；一份坏就不装——半装比不装更难查）
    const v = validateSkills(wanted);
    if (!v.ok) {
      console.error(errOut.err(`✗ skill 源不合法，不装：${v.problems.join(" · ")}`));
      return 1;
    }
    const dirs = targetDirOf(args.dir, only ?? SKILL_NAME);
    let results;
    if (wanted.length === 1) {
      const r = installSkill(dirs.single, { force: args.force === true, name: wanted[0] });
      results = { ok: r.ok, installed: r.ok ? [{ name: r.name, path: r.path, files: r.files }] : [], failed: r.ok ? [] : [{ name: wanted[0], error: r.error }] };
    } else {
      const root = args.dir ? (isAbsolute(args.dir) ? args.dir : join(process.cwd(), args.dir)) : hostRoot();
      results = installSkills(root, { force: args.force === true, names: wanted });
    }
    if (!results.ok) {
      const msg = results.failed.map((f) => `[${f.name}] ${f.error}`).join(" · ");
      if (json) console.log(JSON.stringify({ ok: false, error: msg, failed: results.failed }, null, 2));
      else console.error(errOut.err(`✗ ${msg}`));
      return 1;
    }
    const legacyBlocks = legacyInjectionBlocks(hostRoot());
    const legacyDirs = legacySkillDirs(hostRoot());
    if (json) {
      console.log(JSON.stringify({ ok: true, installed: results.installed, legacy: legacyBlocks, legacySkillDirs: legacyDirs }, null, 2));
      return 0;
    }
    for (const it of results.installed) {
      console.log(out.ok(`✅ skill 已装：${it.path}（${it.files.length} 个文件）`));
    }
    console.log(out.dim(`  · 宿主下次启动会把它列进可用 skill；会话中可 /skill:${results.installed[0]?.name ?? SKILL_NAME} 强制加载`));
    if (legacyBlocks.length) {
      console.log(out.warn(`  ⚠ ${legacyBlocks.join(" / ")} 里还有旧的 <!-- gd:workflow --> 注入块（SOP 已搬进 skill）——可自行删除`));
    }
    if (legacyDirs.length) {
      console.log(out.warn(`  ⚠ ${legacyDirs.join(" / ")}：旧 skill 副本还留在宿主里（已并入 gd-core）——可自行删除（人改过的副本不代删）`));
    }
    return 0;
  }

  console.error(errOut.err(`✗ 未知子命令 "skill ${subName}"。可用：${SKILL_SUBCOMMANDS.join(" / ")}`));
  console.error(SKILL_USAGE);
  return 1;
}

/** 宿主里残留的旧 skill 副本目录（只报告，不代删——人可能改过） */
function legacySkillDirs(root) {
  const hits = [];
  for (const [old, cur] of Object.entries(LEGACY_SKILLS)) {
    if (existsSync(join(root, ".pi", "skills", old))) hits.push(`${old} → ${cur}`);
  }
  return hits;
}

/** 找出宿主注入面里残留的旧 gd:workflow 块（只报告，不修改） */
function legacyInjectionBlocks(root) {
  const hits = [];
  for (const rel of ["AGENTS.md", "CLAUDE.md", ".pi/APPEND_SYSTEM.md"]) {
    const p = join(root, rel);
    if (!existsSync(p)) continue;
    try {
      if (readFileSync(p, "utf8").includes("gd:workflow:begin")) hits.push(rel);
    } catch {}
  }
  return hits;
}

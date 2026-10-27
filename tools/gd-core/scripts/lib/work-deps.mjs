/**
 * `scripts/lib/work-deps.mjs` — **共享依赖**（工作区 × 依赖恢复，core 层）
 *
 * 0.45 · R-gm-45-0 · T-gm-45-0-03
 *
 * ## 要解决什么
 *
 * 每个工作区各自 `npm install`（91 包 / 101MB / ~15s）是**唯一安全**的做法，但成本随并行工作区数线性涨。
 * 想省只能「共享」——而共享的**唯一安全形态**是：**把依赖内容放到所有工作区的公共父目录**，
 *   让 Node 的向上解析命中它（`<repo>.wt/node_modules`），**而不是**把工作区的 `node_modules`
 *   做成指向主仓的联接。
 *
 * ## 两条硬口径（都来自实测）
 *
 *   ① **不许用 junction / symlink 指向主仓 `node_modules`**：
 *      `git worktree remove --force` 的递归删除会把 junction 当普通目录，**顺着联接把主仓依赖清空**
 *      （B-gm-000010 实测：91 个包没了、目录还在）。真要建联接，必须复用
 *      `lib/work-links.mjs` 的 `findExternalLinks` + `unlinkLink`（回收前摘链接），否则等于埋雷。
 *   ② **要「同步」就同步**内容**，不 sync 目录本身**：把 `package.json` + `package-lock.json`
 *      复制到公共父目录，在那儿 `npm ci` 装出**真实目录**。装出来的东西是实体，回收任何工作区都不会穿孔。
 *
 * ## 与 sweep 的耦合（必须同源）
 *
 *   `work-sweep` 决定「这个工作区能不能回收」；本模块决定「回收之后依赖怎么恢复」。
 *   两面必须对齐：**sweep 认为可回收的形态（main / absent / idle / recent），本模块都必须能恢复**——
 *   恢复手段就是「重新在公共父目录 sync 一次」，与具体工作区无关。⇒ 任一侧改判据时，另一侧不许假设「它还在」。
 *
 * ## 与依赖哨兵的关系
 *
 *   `lib/deps-health.mjs` 判「装了没」；它需要知道**在哪找**。本模块提供 `depsRootsFor()`：
 *   工作区自己的 `node_modules` → 公共父目录 → 主仓，**按这个顺序**找（Node 的解析顺序同此）。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** 共享依赖目录名（放在所有工作区的公共父目录下：`<repo>.wt/node_modules`） */
export const SHARED_DEPS_DIR = "node_modules";

/**
 * 某个工作区对应的**公共父目录**（缺省摆法 `<repo>.wt/<单元>` ⇒ 父目录 = `<repo>.wt`）。
 * @param {string} worktreePath
 * @returns {string}
 */
export function sharedRootOf(worktreePath) {
  return dirname(String(worktreePath ?? ""));
}

/**
 * 某仓对应的**公共父目录**（按缺省摆法算：`<repo>.wt`）——
 * 给「还没建工作区、只想知道共享依赖落哪儿」的场景用（不必造假的工作区路径）。
 * @param {string} repo
 * @returns {string}
 */
export function sharedRootForRepo(repo) {
  const r = String(repo ?? "");
  return join(dirname(r), basename(r) + ".wt");
}

/**
 * 某个工作区对应的**共享依赖目录**（`<公共父目录>/node_modules`）。
 * @param {string} worktreePath
 * @returns {string}
 */
export function sharedDepsDirOf(worktreePath) {
  return join(sharedRootOf(worktreePath), SHARED_DEPS_DIR);
}

/**
 * **依赖解析链**（与 Node 的向上解析一致）：工作区自己 → 公共父目录 → 主仓。
 *
 * 返回的是**完整的 node_modules 候选目录**（**含尚未安装的**）—— 哨兵要按这条链找，
 * 报「缺依赖」时才能说全**找过哪些目录**（少一级就会误导人去装错地方）。
 *
 * @param {object} input `{worktreePath, repo}`
 * @returns {string[]} 按解析顺序排列的 `node_modules` 目录
 */
export function depsRootsFor({ worktreePath = "", repo = "" } = {}) {
  const cands = [];
  if (worktreePath) {
    cands.push(join(worktreePath, SHARED_DEPS_DIR));
    cands.push(sharedDepsDirOf(worktreePath));
  }
  if (repo) cands.push(join(repo, SHARED_DEPS_DIR));
  const seen = new Set();
  const out = [];
  for (const c of cands) {
    const key = c.replace(/\\/g, "/");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * 装依赖用的**落点**（sync 时把 package.json / lock 放这儿，`npm ci` 也在这儿跑）。
 * @param {object} input `{worktreePath, sharedRoot}`
 * @returns {string}
 */
export function depsSyncTarget({ worktreePath, sharedRoot } = {}) {
  return sharedRoot ? String(sharedRoot) : sharedRootOf(worktreePath);
}

/**
 * 读 package.json 的依赖声明（**永不抛**）。
 * @param {string} root
 * @returns {{ok:boolean, deps:Record<string,string>, error:string|null}}
 */
export function readDeclared(root) {
  const p = join(String(root ?? ""), "package.json");
  if (!existsSync(p)) return { ok: false, deps: {}, error: `缺 package.json（${p}）` };
  try {
    const doc = JSON.parse(readFileSync(p, "utf8"));
    return { ok: true, deps: { ...(doc.dependencies ?? {}), ...(doc.devDependencies ?? {}) }, error: null };
  } catch (e) {
    return { ok: false, deps: {}, error: `package.json 解析失败：${String(e?.message ?? e)}` };
  }
}

/**
 * **共享依赖状态**（只读）：公共父目录里有几个包、缺哪些、要不要 sync。
 *
 * @param {object} input `{repo, worktreePath}`
 * @returns {{ok:boolean, target:string, present:number, missing:string[], mismatched:Array, needSync:boolean, hint:string}}
 */
export function sharedDepsStatus({ repo, worktreePath, sharedRoot } = {}) {
  const target = depsSyncTarget({ worktreePath, sharedRoot });
  const dir = join(target, SHARED_DEPS_DIR);
  const decl = readDeclared(repo);
  const out = { ok: true, target, present: 0, missing: [], mismatched: [], needSync: false, hint: "" };
  if (!decl.ok) {
    out.ok = false;
    out.hint = decl.error;
    return out;
  }
  const names = Object.keys(decl.deps);
  for (const name of names) {
    const pkgFile = join(dir, name, "package.json");
    if (!existsSync(pkgFile)) {
      out.missing.push(name);
      continue;
    }
    out.present++;
    const want = /^\d+\.\d+\.\d+/.test(String(decl.deps[name] ?? "")) ? String(decl.deps[name]) : null;
    if (!want) continue;
    try {
      const got = JSON.parse(readFileSync(pkgFile, "utf8")).version;
      if (got && String(got) !== want) out.mismatched.push({ name, declared: want, installed: String(got) });
    } catch {
      /* 读不出就当没装好 */
    }
  }
  out.needSync = out.missing.length > 0 || out.mismatched.length > 0;
  if (out.needSync) {
    out.ok = false;
    out.hint =
      `共享依赖未就绪（${dir}）：缺 ${out.missing.length} 个、版本不符 ${out.mismatched.length} 个` +
      ` —— 跑 \`gd work deps --apply\`（会在公共父目录装一份，供所有工作区向上解析命中；不建联接）。`;
  }
  return out;
}

/**
 * **同步共享依赖**（默认只看不动）。
 *
 * 做法（唯一安全形态）：把 `package.json` + `package-lock.json` 复制到公共父目录，
 *   在那里 `npm ci`（或 `npm install`）装出**真实目录**。**不建 junction / symlink**。
 *
 * @param {object} input
 * @param {string} input.repo
 * @param {string} [input.worktreePath]
 * @param {string} [input.sharedRoot]  公共父目录直给（还没建工作区时用）
 * @param {boolean} [input.apply]  true 才真装
 * @param {Function} [input.run]   `(cmd, args, opts) => {ok, stdout, stderr}`（测试注入）
 * @returns {{ok:boolean, applied:boolean, target:string, missing:string[], ran:string|null, error:string|null, hint:string}}
 */
export function syncSharedDeps({ repo, worktreePath, sharedRoot, apply = false, run = null } = {}) {
  const target = depsSyncTarget({ worktreePath, sharedRoot });
  const st = sharedDepsStatus({ repo, worktreePath, sharedRoot });
  const out = { ok: st.ok, applied: false, target, missing: st.missing, ran: null, error: null, hint: st.hint };
  if (!apply) {
    out.hint = st.needSync
      ? `[计划] 在 ${join(target, SHARED_DEPS_DIR)} 装一份共享依赖（缺 ${st.missing.length} 个）。加 --apply 才真装。`
      : `共享依赖已就绪（${join(target, SHARED_DEPS_DIR)}），无需同步。`;
    return out;
  }
  if (!existsSync(join(repo, "package.json"))) {
    out.ok = false;
    out.error = `主仓缺 package.json（${repo}）——没有声明就无法 sync`;
    return out;
  }
  try {
    mkdirSync(target, { recursive: true });
    copyFileSync(join(repo, "package.json"), join(target, "package.json"));
    const lock = join(repo, "package-lock.json");
    const hasLock = existsSync(lock);
    if (hasLock) copyFileSync(lock, join(target, "package-lock.json"));
    if (typeof run === "function") {
      const cmd = hasLock ? "npm ci" : "npm install";
      const r = run(cmd, [], { cwd: target });
      out.ran = cmd;
      if (!r?.ok) {
        out.ok = false;
        out.error = String(r?.stderr || r?.error || "装依赖失败").slice(0, 300);
        return out;
      }
    }
    out.applied = true;
    const after = sharedDepsStatus({ repo, worktreePath, sharedRoot });
    out.ok = !after.needSync;
    out.missing = after.missing;
    out.hint = out.ok
      ? `共享依赖已装好：${join(target, SHARED_DEPS_DIR)}（所有工作区向上解析会命中它；没有建任何联接）`
      : `装完仍缺 ${after.missing.length} 个包——看 npm 输出`;
    return out;
  } catch (e) {
    out.ok = false;
    out.error = String(e?.message ?? e);
    return out;
  }
}

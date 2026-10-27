/**
 * `scripts/lib/deps-health.mjs` — **依赖健康哨兵**（core 层）
 *
 * 0.45 · R-gm-45-0 · T-gm-45-0-04
 *
 * ## 为什么要有它（今天的实测现场）
 *
 * 主仓 `node_modules` 被清空过一次（目录还在、内容没了）——**期间没有任何环节报一句人话**。
 *   直到跑 e2e 才炸「Cannot find package」，人还以为是代码坏了，白跑了几轮门禁。
 *
 * 更贵的同型问题：在**隔离工作区**里跑 durable 系 e2e，若该工作区没装依赖，
 *   8 条断言各自红一遍（B3/B4/F1/F2…），真因是「环境没装」，但看着像「代码错」。
 *
 * **判据**：工具必须自己说出「这是环境问题，不是代码问题」——不能靠人记。
 *
 * ## 检什么（三档，越靠前越便宜）
 *
 *   ① `package.json` 声明的每个依赖，`node_modules/<name>/package.json` 是否存在
 *   ② 是否存在 + 版本是否与声明**精确一致**（声明 `1.3.0` ⇒ 装的就该是 `1.3.0`）
 *   ③ Node 版本是否达标（`engines.node`）
 *
 * **不检**「lock 与 package 一致」——那是 `ai-durable-version-check` 的事（升级守卫），
 *   本模块管的是**装没装、装对了没**（运行时守卫）。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 读 package.json 里声明的依赖（dependencies + devDependencies）。
 * @returns {Record<string, string>}
 */
export function declaredDeps(root) {
  const p = join(root, "package.json");
  if (!existsSync(p)) return {};
  try {
    const doc = JSON.parse(readFileSync(p, "utf8"));
    return { ...(doc.dependencies ?? {}), ...(doc.devDependencies ?? {}) };
  } catch {
    return {};
  }
}

/** 剥掉 semver 前缀（`^1.2.3` → `1.2.3`）；非精确版本返回 null（不猜） */
function exactOf(spec) {
  const s = String(spec ?? "").trim();
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(s) ? s : null;
}

/**
 * **依赖健康检查**（**永不抛**）。
 *
 * @param {object} [input]
 * @param {string} input.root            仓根（缺省 = 调用方传；本模块不猜路径）—— 兼作**声明源**
 * @param {object} [input.env]           环境（`GD_SKIP_DEPS_CHECK=1` 可跳）
 * @param {string[]} [input.only]        只检这些包（缺省 = package.json 里全部）
 * @param {string[]} [input.moduleDirs]  额外查找的 **node_modules 目录**（按解析顺序；不含的也会列进「找过」）
 * @returns {{ok:boolean, checked:number, missing:Array<{name:string,why:string}>, mismatched:Array<{name:string,declared:string,installed:string}>, hint:string}}
 */
export function checkDepsHealth({ root, env = process.env, only = null, moduleDirs = [] } = {}) {
  const out = { ok: true, checked: 0, missing: [], mismatched: [], hint: "" };
  if (!root) {
    out.ok = false;
    out.missing.push({ name: "(root)", why: "缺 root：调用方要给仓根，本模块不猜路径" });
    return out;
  }
  if (String(env.GD_SKIP_DEPS_CHECK ?? "") === "1") {
    out.hint = "GD_SKIP_DEPS_CHECK=1 —— 已跳过依赖健康检查";
    return out;
  }
  const declared = declaredDeps(root);
  const names = Array.isArray(only) && only.length ? only : Object.keys(declared);
  // 0.45 T-gm-45-0-03：**按 Node 的向上解析顺序找** —— 工作区 → 公共父目录 → 主仓。
  //   共享依赖落地后，工作区自己没装但父目录有，是真能用 ⇒ 只看 root 会误报「缺依赖」。
  //   任一处命中即算装了；全都没命中才报缺，并在 why 里点名**找过哪些目录**。
  //   `moduleDirs` 是调用方给的 node_modules 目录（已按解析顺序排好）；root/node_modules 作**最后一级**兜底。
  const dirs = [];
  const seenDirs = new Set();
  const pushDir = (d) => {
    if (!d) return;
    const key = String(d).replace(/\\/g, "/");
    if (seenDirs.has(key)) return;
    seenDirs.add(key);
    dirs.push(String(d));
  };
  for (const d of Array.isArray(moduleDirs) ? moduleDirs : []) pushDir(d);
  if (root) pushDir(join(root, "node_modules"));
  for (const name of names) {
    out.checked++;
    let pkgFile = null;
    for (const d of dirs) {
      const f = join(d, name, "package.json");
      if (existsSync(f)) {
        pkgFile = f;
        break;
      }
    }
    if (!pkgFile) {
      const where = dirs.join(" → ");
      out.missing.push({ name, why: `按解析顺序都没找到（找过：${where}）` });
      continue;
    }
    const want = exactOf(declared[name]);
    if (!want) continue; // 声明不是精确版本 ⇒ 不比版本（不猜）
    let got = null;
    try {
      got = JSON.parse(readFileSync(pkgFile, "utf8")).version ?? null;
    } catch {
      got = null;
    }
    if (got && String(got) !== want) {
      out.mismatched.push({ name, declared: want, installed: String(got) });
    }
  }
  if (out.missing.length || out.mismatched.length) {
    out.ok = false;
    const bits = [];
    if (out.missing.length) bits.push(`缺 ${out.missing.length} 个包（${out.missing.slice(0, 3).map((m) => m.name).join(" / ")}${out.missing.length > 3 ? " 等" : ""}）`);
    if (out.mismatched.length) bits.push(`${out.mismatched.length} 个版本不符（${out.mismatched.slice(0, 2).map((m) => `${m.name} 声明 ${m.declared} 装的是 ${m.installed}`).join("；")}）`);
    out.hint =
      `${bits.join(" · ")}。**这是环境问题，不是代码问题** —— 在本仓根装一次依赖：` +
      (dirs.length > 1
        ? "`npm ci`（按 lock 精确装，推荐）或 `npm install`；共享依赖的话：`gd work deps --apply`（装到公共父目录，不建联接）。"
        : "`npm ci`（按 lock 精确装，推荐）或 `npm install`；装完重跑这条检查。"
      );
  }
  return out;
}

/**
 * 人话摘要（一行；健康 ⇒ 空串，调用方决定要不要打印）。
 * @param {ReturnType<typeof checkDepsHealth>} r
 */
export function depsHealthLine(r) {
  if (!r || r.ok) return "";
  return `E_DEPS_MISSING：${r.hint}`;
}

/** 给 CLI / e2e 用的便捷判定：**环境**问题（区别于代码错） */
export function isEnvProblem(r) {
  return Boolean(r && r.ok === false);
}

/**
 * work-links —— 工作区「指向外部的联接」扫描与摘除（core 层 · B-gm-000010-01 · 0.45 T-gm-45-0-02）
 *
 * 为什么单独立出来：这两件事（扫出来 / 摘掉）被**三处**共用 ——
 *   `gd work start`（建完先查一次，别让联接躺进工作区）、
 *   `gd work land`（回收前先摘，否则 git 的递归删除会穿透）、
 *   `gd work sweep`（清扫回收前同样先摘）。
 *   各写一份就是三个真相源，迟早有一个漏掉 —— 而漏掉的代价是**主仓依赖被清空**。
 *
 * 硬事实（B-gm-000010 实测）：`git worktree remove --force` 的递归删除会把 Windows 的
 *   **junction 当普通目录**，顺着联接把**目标里的内容**删掉。实测：工作区里放
 *   `node_modules` 联接指向主仓的 `node_modules`，回收工作区后主仓 91 个包被清、
 *   `node_modules` 目录却还在（「目录在、内容没了」，最容易误判成 npm 的问题）。
 *   Node 的 `rmSync` 对 junction **只删链接本身**，不碰目标 ⇒ 摘链接这一步必须由 Node 做。
 */
import { existsSync, lstatSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/**
 * 扫一个目录里的**危险联接**（reparse point / symlink，且**指向目录外**）。
 * @param {string} root 要扫的目录（工作区根）
 * @param {number} [maxDepth] 扫几层（默认 2：根级 + 依赖目录一级；不进 `.git`）
 * @returns {{path:string, target:string, kind:"link"}[]}
 */
export function findExternalLinks(root, maxDepth = 2) {
  const found = [];
  const rootAbs = resolve(root);
  const walk = (dir, depth) => {
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === ".git") continue;
      const full = join(dir, name);
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        // junction 与 symlink 在 lstat 上一视同仁（isSymbolicLink）⇒ 用目标路径判「是否出界」
        let target = "";
        try {
          target = readlinkSync(full);
        } catch {
          target = "";
        }
        const abs = target && isAbsolute(target) ? resolve(target) : resolve(dirname(full), target);
        const inside = abs === rootAbs || !relative(rootAbs, abs).startsWith("..");
        if (!inside) found.push({ path: full, target: abs, kind: "link" });
        continue;
      }
      if (depth < maxDepth && st.isDirectory()) walk(full, depth + 1);
    }
  };
  walk(rootAbs, 0);
  return found;
}

/**
 * 把**联接本身**摘掉（**不碰它的目标**）。
 * 摘不掉就返回 false —— 由调用方拒绝继续回收，别硬来。
 * @param {string} p 联接路径
 * @returns {boolean} 是否已摘掉
 */
export function unlinkLink(p) {
  try {
    rmSync(p, { recursive: true, force: true });
    return !existsSync(p);
  } catch {
    return false;
  }
}

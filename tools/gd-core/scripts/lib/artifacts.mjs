/**
 * 交付件指纹（artifacts）—— **core 层**（0.23.0 R-gm-047-01）
 *
 * 为什么单独成文件：`gd handoff --artifact` 要现场算件指纹（文件 sha256 / 目录逐文件合成 sha256），
 *   而 handoff 已 core 化——指纹算法若是 app 件（`boardops.mjs`，为合批提交拖着 `git.mjs` → 注册表），
 *   core 闭包就被拽出界。这里只依赖 node 内置，`boardops.mjs` 反向再导出（实现仍一份）。
 *
 * 口径不变（0.16.7 起）：`sha256:<hex>`；目录按相对路径排序后逐文件拼 manifest 再哈希。
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { nowIso } from "./board.mjs";

/** 单文件 sha256 */
function hashFile(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

/**
 * 包件（目录）指纹：条目已按工作树口径排好序 ⇒ 行 = `<相对路径> <文件 sha256>`，整体再 sha256。
 *
 * 为什么要抽出来（0.70.6 · B-gm-000060）：同一份内容可能从**两个地方**算指纹——
 *   工作树（`checksumOfPath`）与某个提交里（`artifact-git.mjs` 的包件读面）。
 *   两边排序口径必须一模一样，否则同一份内容算出两个数 ⇒ 假失配。
 *   口径 = 每个目录内按名排序、深度优先（目录就地递归）、跳过点开头项。
 * @param {{rel: string, hash: string}[]} entries 已按上面口径排好序（hash = 内容 sha256 的 hex，不带前缀）
 * @returns {string} `sha256:<hex>`
 */
export function packageChecksumOf(entries) {
  const manifest = (entries ?? []).map((e) => `${e.rel} ${e.hash}`).join("\n");
  return `sha256:${createHash("sha256").update(manifest).digest("hex")}`;
}

/**
 * 件指纹：文件 → 内容 sha256；目录（package）→ 逐文件（按相对路径排序）拼接后再 sha256。
 * @param {string} absPath
 * @returns {string|null} `sha256:<hex>`；路径不存在返回 null
 */
export function checksumOfPath(absPath) {
  if (!existsSync(absPath)) return null;
  if (statSync(absPath).isFile()) return `sha256:${hashFile(absPath)}`;
  const files = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir).sort()) {
      if (n.startsWith(".")) continue;
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(absPath);
  return packageChecksumOf(files.map((p) => ({ rel: relative(absPath, p).split("\\").join("/"), hash: hashFile(p) })));
}

/**
 * 交付件条目（相对项目根路径 → artifacts 段条目）
 *
 * `source` = 指纹取自哪儿（0.70.6 · B-gm-000060）：
 *   · `commit`  = 取自**落地提交里的内容**（交件时优先；权威事实源）
 *   · `worktree`= 取自工作树字节（没有提交可依时；例如 `--direct` 未提交交付）
 *   两者不可混为一谈：工作树视图会随后续提交漂移，指纹校验据此决定能不能按提交核。
 * `source_commit` = 算出这个指纹的那个提交（只 source=commit 时有）：
 *   **必须逐件记**：任务的 `landed.head` 不稳（同工作单元里再 land 一次会把它刷成新头），
 *   而「我交的是哪个提交」是逐件的事实 ⇒ 验收侧靠它判「成果还在不在」。
 */
export function artifactOf(projDir, rel, { source = "worktree", sourceCommit = null } = {}) {
  const abs = join(projDir, rel);
  if (!existsSync(abs)) return null;
  const isDir = statSync(abs).isDirectory();
  return {
    path: String(rel).split("\\").join("/"),
    kind: isDir ? "package" : "file",
    checksum: checksumOfPath(abs),
    at: nowIso(),
    source,
    ...(sourceCommit ? { source_commit: String(sourceCommit) } : {}),
  };
}

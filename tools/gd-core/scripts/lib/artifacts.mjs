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
  const manifest = files.map((p) => `${relative(absPath, p).split("\\").join("/")} ${hashFile(p)}`).join("\n");
  return `sha256:${createHash("sha256").update(manifest).digest("hex")}`;
}

/** 交付件条目（相对项目根路径 → artifacts 段条目） */
export function artifactOf(projDir, rel) {
  const abs = join(projDir, rel);
  if (!existsSync(abs)) return null;
  const isDir = statSync(abs).isDirectory();
  return {
    path: String(rel).split("\\").join("/"),
    kind: isDir ? "package" : "file",
    checksum: checksumOfPath(abs),
    at: nowIso(),
  };
}

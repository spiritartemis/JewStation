/**
 * 交付件 × git 读面 —— **core 层**（0.70.6 · B-gm-000060）
 *
 * 为什么要有它：验收闸门要判「**我的成果还在不在**」，事实源是**落地提交里那份内容**，
 *   不是工作树字节——工作树会被后续任务合法改动（改同一个文件 / 删掉这个文件），
 *   拿它当事实源 ⇒「后续任务合法改动」与「成果被回退」被判成同一件事（假阳性）。
 *   本仓历史上这道闸 3 次触发全是假阳性、0 次真阳性（见 B-gm-000060 摘要）。
 *
 * 分层：只 spawn git，**零 app import**——不碰 `lib/git.mjs`（那条经注册表依赖 app 层，core 用不了）。
 *   读不到一律返回 null（调用方按「不判」处理：绝不因为读不到就拒）。
 *
 * 口径：
 *   · 包件（目录）在提交里的指纹，按**工作树同一口径**算（每目录内按名排序、深度优先、跳过点开头项），
 *     否则同一份内容两套排序 ⇒ 假失配。
 *   · 「后续谁碰过」只作提示，不拦（成果仍在就是成果仍在）。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { packageChecksumOf } from "./artifacts.mjs";

/** git 输出上限（目录件可能很大；够用即可，超了当读不到） */
const MAX_BUF = 256 * 1024 * 1024;

/**
 * 跑一条 git 命令。
 * @param {string} repoRoot 仓根（= 交付件基准）
 * @param {string[]} args
 * @param {{buffer?: boolean, input?: string|Buffer}} [opts]
 * @returns {string|Buffer|null} 失败一律 null（读不到 ≠ 有问题）
 */
function run(repoRoot, args, opts = {}) {
  let r;
  try {
    r = spawnSync("git", args, {
      cwd: repoRoot,
      encoding: opts.buffer ? "buffer" : "utf8",
      input: opts.input,
      maxBuffer: MAX_BUF,
      windowsHide: true,
    });
  } catch {
    return null;
  }
  if (r.error || r.status !== 0) return null;
  return r.stdout;
}

/** 是不是 git 工作区（读不到 ⇒ false，调用方退回旧口径） */
export function isGitRepo(repoRoot) {
  const out = run(repoRoot, ["rev-parse", "--is-inside-work-tree"]);
  return typeof out === "string" && out.trim() === "true";
}

/** HEAD 提交号 */
export function headOf(repoRoot) {
  const out = run(repoRoot, ["rev-parse", "HEAD"]);
  return typeof out === "string" ? out.trim() || null : null;
}

/**
 * 某提交里某路径的类型。
 * @returns {"blob"|"tree"|null} null = 读不到 / 不存在
 */
export function typeAt(repoRoot, commit, relPath) {
  const out = run(repoRoot, ["cat-file", "-t", `${commit}:${relPath}`]);
  if (typeof out !== "string") return null;
  const t = out.trim();
  return t === "blob" || t === "tree" ? t : null;
}

/** 某提交里某文件的件指纹（`sha256:<hex>`）；读不到返回 null */
export function checksumOfFileAt(repoRoot, commit, relPath) {
  const buf = run(repoRoot, ["cat-file", "blob", `${commit}:${relPath}`], { buffer: true });
  if (buf === null || !Buffer.isBuffer(buf)) return null;
  return `sha256:${createHash("sha256").update(buf).digest("hex")}`;
}

/**
 * 某提交里某目录（包件）的件指纹 —— 与工作树同一口径。
 * @returns {string|null} null = 读不到 / 空目录
 */
export function checksumOfPackageAt(repoRoot, commit, relPath) {
  const raw = run(repoRoot, ["ls-tree", "-r", "-z", commit, "--", relPath]);
  if (typeof raw !== "string") return null;
  const prefix = String(relPath ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  const files = [];
  for (const rec of raw.split("\0")) {
    if (!rec) continue;
    const tab = rec.indexOf("\t");
    if (tab < 0) continue;
    const meta = rec.slice(0, tab).split(/\s+/);
    if (meta[1] !== "blob") continue;
    const path = rec.slice(tab + 1);
    if (prefix && !path.startsWith(`${prefix}/`)) continue;
    const rel = path.slice(prefix ? prefix.length + 1 : 0);
    // 与工作树口径一致：点开头的项（文件或目录）整支跳过
    if (rel.split("/").some((seg) => seg.startsWith("."))) continue;
    files.push({ rel, sha: meta[2] });
  }
  if (!files.length) return null;
  const ordered = orderLikeWorktree(files);
  const hashes = catFileHashes(repoRoot, ordered.map((f) => f.sha));
  if (!hashes) return null;
  const entries = [];
  for (const f of ordered) {
    const h = hashes.get(f.sha);
    if (!h) return null;
    entries.push({ rel: f.rel, hash: h });
  }
  return packageChecksumOf(entries);
}

/**
 * 某提交里某路径的件指纹（文件 / 目录自动判形态）。
 * @param {string} repoRoot
 * @param {string} commit
 * @param {string} relPath 仓内相对路径（`/` 分隔）
 * @param {"file"|"package"} [kind] 已知形态；不给就按提交里的实际形态判
 * @returns {string|null}
 */
export function checksumOfPathAt(repoRoot, commit, relPath, kind = null) {
  if (!commit || !relPath) return null;
  const t = kind === "package" ? "tree" : typeAt(repoRoot, commit, relPath);
  if (t === "tree") return checksumOfPackageAt(repoRoot, commit, relPath);
  if (t === "blob" || kind === "file") return checksumOfFileAt(repoRoot, commit, relPath);
  return null;
}

/**
 * 某区间里改过某路径的提交（谁在我之后碰过它）。
 * @param {string} repoRoot
 * @param {string} from 起点提交（不含）
 * @param {string} to 终点提交（HEAD）
 * @returns {{sha: string, subject: string}[]|null} null = 读不到
 */
export function commitsTouching(repoRoot, from, to, relPath) {
  const raw = run(repoRoot, ["log", "--format=%h%x09%s", `${from}..${to}`, "--", relPath]);
  if (typeof raw !== "string") return null;
  const out = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const [sha, ...rest] = t.split("\t");
    out.push({ sha, subject: rest.join("\t") });
  }
  return out;
}

/**
 * 工作树里这些路径有没有未提交改动（未提交的改动**不会**被 land 带走，与已交付内容无关）。
 * @returns {string[]|null} null = 读不到
 */
export function dirtyPaths(repoRoot, relPaths) {
  const paths = (relPaths ?? []).filter(Boolean);
  if (!paths.length) return [];
  const raw = run(repoRoot, ["status", "--porcelain", "--", ...paths]);
  if (typeof raw !== "string") return null;
  const out = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * 批量读 blob 内容哈希（`git cat-file --batch` 一次进程读完，别一个文件一个进程）。
 * @param {string} repoRoot
 * @param {string[]} shas
 * @returns {Map<string,string>|null} sha → 内容 sha256（hex）
 */
function catFileHashes(repoRoot, shas) {
  if (!shas.length) return new Map();
  const buf = run(repoRoot, ["cat-file", "--batch"], { buffer: true, input: Buffer.from(`${shas.join("\n")}\n`) });
  if (buf === null || !Buffer.isBuffer(buf)) return null;
  const map = new Map();
  let off = 0;
  while (off < buf.length) {
    const nl = buf.indexOf(10, off);
    if (nl < 0) break;
    const header = buf.subarray(off, nl).toString("utf8").trim();
    off = nl + 1;
    const parts = header.split(/\s+/);
    const sha = parts[0];
    const type = parts[1];
    if (type === "missing") continue; // 读不到的那个对象：跳过（调用方按缺哈希处理）
    const size = Number(parts[2]);
    if (!Number.isFinite(size)) return null;
    const content = buf.subarray(off, off + size);
    off += size + 1; // 跳过内容后的换行
    if (type === "blob") map.set(sha, createHash("sha256").update(content).digest("hex"));
  }
  return map;
}

/**
 * 按**工作树同一口径**给包件条目排序：每个目录内按名排序、深度优先、点开头项跳过。
 * （工作树那侧是 `readdirSync(dir).sort()` 后逐项处理——目录就地递归，文件直接收。）
 * @param {{rel: string, sha: string}[]} files
 * @returns {{rel: string, sha: string}[]}
 */
function orderLikeWorktree(files) {
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const segs = f.rel.split("/");
    let node = root;
    for (let i = 0; i < segs.length - 1; i++) {
      if (!node.dirs.has(segs[i])) node.dirs.set(segs[i], { dirs: new Map(), files: [] });
      node = node.dirs.get(segs[i]);
    }
    node.files.push({ name: segs[segs.length - 1], sha: f.sha, rel: f.rel });
  }
  const out = [];
  const walk = (node) => {
    const names = [...node.dirs.keys(), ...node.files.map((x) => x.name)].sort();
    for (const name of names) {
      if (node.dirs.has(name)) {
        walk(node.dirs.get(name));
        continue;
      }
      const hit = node.files.find((x) => x.name === name);
      if (hit) out.push(hit);
    }
  };
  walk(root);
  return out;
}

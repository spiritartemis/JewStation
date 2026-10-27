/**
 * git 纯操作（core 层 · 0.19.0 R-gm-005）—— **从 lib/git.mjs 抽出的零宿主子集**
 *
 * 为什么要抽：`lib/git.mjs` 负责「项目库提交/推送」这类 app 行为（要读注册表、要版本号 trailer），
 *   而 core 的并发隔离（`gd work start/submit/land`）只需要**纯粹的 git 操作**。
 *   把子集抽到这里后，core 闭包不再拖进 `registry.mjs` / `guide.mjs` / `gdversion.mjs`。
 *
 * 口径：本文件**只依赖 node 内置**；`lib/git.mjs` 反向从这里 re-export，保证实现仍是一份。
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** 执行 git 命令；返回 { ok, code, stdout, stderr, timed_out }（均 trim 过）
 * `timeoutMs`：给命令加上限（网络类命令如 `git fetch` 必须给——否则上游卡住会把调用方整个阻塞）；
 *   超时由 `spawnSync` 以 `error.code = ETIMEDOUT` 告知（同时 killSignal = SIGKILL）。 */
//   `windowsHide: true`（0.15.3 弹窗修复）：本模块被**无控制台**的常驻进程调用（工作站后台服务 / 席位守护 /
//   自举重启的子实例）。缺它时 Windows 会给**每次** git 调用新分配一个控制台窗口——实测工作站每 60s reconcile
//   会冒出 6–8 个终端窗口（真机复现：ppid = 工作站进程的 git.exe 各自带一个 conhost.exe）。
export function runGit(repoDir, args, { input, timeoutMs } = {}) {
  const r = spawnSync("git", args, {
    cwd: repoDir,
    encoding: "utf8",
    windowsHide: true,
    input,
    maxBuffer: 32 * 1024 * 1024,
    ...(timeoutMs ? { timeout: timeoutMs, killSignal: "SIGKILL" } : {}),
  });
  if (r.error) {
    const timedOut = r.error.code === "ETIMEDOUT";
    return { ok: false, code: -1, timed_out: timedOut, stdout: "", stderr: timedOut ? `超时（>${timeoutMs}ms）已中止` : String(r.error.message) };
  }
  return { ok: r.status === 0, code: r.status, timed_out: false, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim() };
}

/**
 * 执行 git 命令，返回**原始** stdout（**不 trim**）——内容 hash / 逐行比对场景必须用。
 * 理由：`runGit` 会 trim 首尾空白，文件末尾换行被吃掉 → 与工作区原文 hash 不等，判据误报。
 * @returns {{ok:boolean, code:number, stdout:string, stderr:string}}
 */
export function runGitRaw(repoDir, args, { input } = {}) {
  const r = spawnSync("git", args, {
    cwd: repoDir,
    encoding: "utf8",
    windowsHide: true,
    input,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error) return { ok: false, code: -1, stdout: "", stderr: String(r.error.message) };
  return { ok: r.status === 0, code: r.status, stdout: r.stdout ?? "", stderr: (r.stderr ?? "").trim() };
}

/**
 * 执行 git 命令，stdout 以 **Buffer** 返回（字节安全）。
 *
 * 用途：`git cat-file --batch` 的输出是「头行 + <size> 字节 + 换行」的二进制流，
 *   `encoding: "utf8"` 会先按 UTF-16 解码 ⇒ 按字符切片就对不上字节数（中文 YAML 必错）。
 * 只给批量读取口用；普通命令仍走 `runGit`。
 * @returns {{ok:boolean, code:number, stdout:Buffer, stderr:string}}
 */
export function runGitBuffer(repoDir, args, { input } = {}) {
  const r = spawnSync("git", args, {
    cwd: repoDir,
    windowsHide: true,
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) return { ok: false, code: -1, stdout: Buffer.alloc(0), stderr: String(r.error.message) };
  return { ok: r.status === 0, code: r.status, stdout: r.stdout ?? Buffer.alloc(0), stderr: String(r.stderr ?? "").trim() };
}

/** git 是否可用（本机 PATH 中有 git 且能执行） */
export function isGitAvailable() {
  const r = spawnSync("git", ["--version"], { encoding: "utf8", windowsHide: true });
  return !r.error && r.status === 0;
}

/**
 * 目录是否**自身即为** git 仓库根（非父仓库回溯）。
 * 防坑：`git rev-parse` 会向上找父仓库——若项目目录位于 gdMain 主库内（projects/ 被主库 ignore
 * 但物理在其中），裸 rev-parse 会误判为「已是仓库」，进而把提交误落到主库。故须同时校验：
 *   ① 目录下存在 .git（自身根标记）② show-toplevel 等于该目录。
 */
export function isRepo(dir) {
  if (!dir || !existsSync(dir)) return false;
  if (!existsSync(join(dir, ".git"))) return false;
  const r = runGit(dir, ["rev-parse", "--show-toplevel"]);
  if (!r.ok || !r.stdout) return false;
  return resolve(r.stdout) === resolve(dir);
}

/**
 * `git status --porcelain` 输出 → **相对路径列表**（porcelain 解析的单一事实源）。
 *
 * 两个必须踩准的细节（都踩过）：
 *   · **必须用 `runGitRaw`**：porcelain 对「已跟踪但未暂存」的修改以**空格开头**（` M path`），
 *     而 `runGit` 会 trim 掉行首空格 ⇒ 路径被多切一个字符（`reqs/...` → `eqs/...`）而静默丢文件。
 *   · **尊重 .gitignore**：porcelain 不列被忽略的条目——拿它当 `git add` 的输入才不会被拒收
 *     （目录枚举做不到这点，项目中带 `.seat-logs/` / `seat.config.yaml` 时会把整条命令拖垮）。
 *
 * @param {string} repoDir 仓库根
 * @param {string[]} [scope] 额外 pathspec（如 `["--", "reqs", "events.jsonl"]`）
 * @returns {string[]} 相对路径（重命名取新名；含工作区已删的条目）
 */
export function porcelainPaths(repoDir, scope = []) {
  const r = runGitRaw(repoDir, ["status", "--porcelain", ...scope]);
  if (!r.ok) return [];
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.slice(3).trim()) // 去掉 `XY ` 两列状态 + 一格
    .map((p) => p.split(" -> ").pop()) // 重命名：`old -> new` 取新名
    .filter(Boolean);
}

/**
 * 库内**全部**脏路径的顶层条目（`gd git commit --all` 同口径：逐个顶层名，不是 `add -A` 兜底）。
 * @returns {string[]} 去重后的顶层相对路径（含工作区已删的条目）
 */
export function dirtyTopPaths(repoDir) {
  if (!isRepo(repoDir)) return [];
  const tops = porcelainPaths(repoDir)
    .map((p) => p.split("\\").join("/").split("/")[0]) // 路径 → 顶层条目
    .filter((n) => n && n !== ".git");
  return [...new Set(tops)];
}

/**
 * **一次 `git status --porcelain=v2 --branch` 拿全同步面**（R-gm-47-11 T-02）。
 *
 * 为什么要合：看板每轮构建都要回答「上游是谁 / 领先落后几个 / 工作区哪些脏」——
 *   旧口径是 `readRemoteSync`（`rev-parse @{u}` + `rev-list` = 2 个进程）+ `dirtyTopPaths`
 *   （`isRepo` 的 `rev-parse` + `status` = 2 个进程）= **每次 4 个进程**；实测单套 e2e 里这一处被调
 *   258 次（本机 ~165ms/进程 ⇒ 光这个函数就吃掉 170s 上下）。
 * `--porcelain=v2 --branch` 的头行本来就带 `branch.upstream` 与 `branch.ab +A -B`，其余行就是脏条目
 *   ⇒ 三件事一个进程答完。
 *
 * 口径与旧实现逐项对齐：
 *   · **不是仓库 ⇒ 全空**（旧 `isRepo` 严格判「自身即仓库根」；这里用「目录下有 `.git`」等价区分——
 *     项目库恒为自己的仓库根，worktree 下 `.git` 是文件也照样成立）。
 *   · **没有 upstream ⇒ `hasUpstream:false` + ahead/behind 0**（旧口径同样如此，调用方只看这个字段）。
 *   · `dirtyTop` 与 `dirtyTopPaths` 同口径：重命名取新名、按顶层条目去重、剔除 `.git`。
 *   · **不支持指定分支**：`--branch` 头行只描述 HEAD 的 upstream；要问别的分支仍走 `readRemoteSync(dir, branch)`。
 *
 * @param {string} repoDir 项目库根
 * @returns {{ isRepo: boolean, hasUpstream: boolean, upstream: string,
 *             ahead: number, behind: number, dirtyTop: string[] }}
 */
export function syncStatusOf(repoDir) {
  const none = { isRepo: false, hasUpstream: false, upstream: "", ahead: 0, behind: 0, dirtyTop: [] };
  if (!repoDir || !existsSync(join(repoDir, ".git"))) return none;
  // 必须 `runGitRaw`：`? path` / `1 XY …` 行的语义靠逐字解析，trim 会把行首空格吃掉
  const r = runGitRaw(repoDir, ["status", "--porcelain=v2", "--branch", "--untracked-files=normal"]);
  if (!r.ok) return none;
  let upstream = "";
  let ahead = 0;
  let behind = 0;
  const tops = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("# ")) {
      const mAb = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line);
      if (mAb) {
        ahead = Number(mAb[1]);
        behind = Number(mAb[2]);
        continue;
      }
      const mUp = /^# branch\.upstream (.+)$/.exec(line);
      if (mUp) upstream = mUp[1].trim();
      continue; // `# branch.head` / `# branch.oid` 之类不求值
    }
    // 脏条目：`1` 普通变更（8 个定宽字段 + 路径）/ `2` 重命名（路径\t原名）/
    //        `u` 未合并（10 个字段）/ `?` 未跟踪 / `!` 被忽略（--ignored 才出现）
    const kind = line[0];
    let path = "";
    if (kind === "1") path = line.split(" ").slice(8).join(" ");
    else if (kind === "2") path = line.split(" ").slice(8).join(" ").split("\t")[0];
    else if (kind === "u") path = line.split(" ").slice(10).join(" ");
    else if (kind === "?" || kind === "!") path = line.slice(2);
    if (!path) continue;
    const top = path.split("\\").join("/").split("/")[0]; // 与 dirtyTopPaths 同口径：顶层条目
    if (top && top !== ".git") tops.push(top);
  }
  return {
    isRepo: true,
    hasUpstream: Boolean(upstream),
    upstream,
    ahead,
    behind,
    dirtyTop: [...new Set(tops)],
  };
}

/**
 * 精确 pathspec 提交（永不 `add -A`）。
 * @returns {{ ok: boolean, hash?: string|null, nochange?: boolean, errors?: string[] }}
 */
export function commitFiles(repoDir, { message, paths = [] }) {
  // 安全网：非本目录仓库根拒绝提交（防误提交到父仓库，如 gdMain 主库）
  if (!isRepo(repoDir)) {
    return { ok: false, errors: [`目标目录不是独立 git 仓库根（拒绝提交，防误落父仓库）：${repoDir}`] };
  }
  const v = validateCommitMessage(message);
  if (!v.ok) return { ok: false, errors: v.errors };

  // **已跟踪但工作区已删**的路径也要能进 add（否则删除永远提交不掉，--all 尤其明显）：
  //   存在性检查会把它当无效路径滤掉，于是「删了一整个目录」这类改动被静默跳过。
  const isTracked = (p) => {
    const r = runGit(repoDir, ["ls-files", "--", p]);
    return r.ok && r.stdout.trim() !== "";
  };
  const addable = [...new Set(paths.map((p) => String(p).replace(/\\/g, "/")))].filter(
    (p) => p && (existsSync(join(repoDir, p)) || isTracked(p))
  );
  if (addable.length === 0) return { ok: false, errors: ["无有效提交路径（paths 为空或均不存在——精确提交，不兜底 add -A）"] };

  const add = runGit(repoDir, ["add", "--", ...addable]);
  if (!add.ok) return { ok: false, errors: [`git add 失败：${add.stderr || add.stdout}`] };

  const staged = runGit(repoDir, ["diff", "--cached", "--name-only"]);
  if (staged.ok && staged.stdout === "") return { ok: true, nochange: true, hash: null };

  const c = runGit(repoDir, ["commit", "-F", "-"], { input: message });
  if (!c.ok) return { ok: false, errors: [`git commit 失败：${c.stderr || c.stdout}`] };
  const hash = runGit(repoDir, ["rev-parse", "--short", "HEAD"]).stdout;
  return { ok: true, nochange: false, hash };
}

/**
 * 组装规范 commit message。
 * @param {object} o
 * @param {string} o.type feat|fix|docs|refactor|chore|revert
 * @param {string} o.scope 白名单 scope
 * @param {string} o.summary H1 简述（中文）
 * @param {string} [o.body] 可选说明段
 * @param {Record<string,string|string[]>} [o.trailers] trailer 值（数组自动 join ", "）
 */
export const COMMIT_SCOPES = [
  "design", "economy", "art", "world", "market", // 领域
  "init", "req", "task", "deliverable", "accept", "archive", "station", // 治理（station = 0.9.0 工作站服务代笔：派单 / 验收 / 意图 / 结转）
  "seat", // 治理（0.10.0：user 侧席位注册账——席位表 / 凭证账本 / 分支就位；席位自提交用 `seat:<席位id>`）
  "board", // 治理（0.14.0 轻协议：两账合批提交——任务账 / 事件流 / 需求派生态）
  "milestone", // 治理（0.15.4 里程碑账：milestones.yaml——项目级时间锚）
];

export const TRAILER_REQUIRED = ["提交人"];

// 需求 / 缺陷 id 口径单一事实源（0.23.0 R-gm-061）：R = feature/chore · B = bug
export { REQ_ID_RE };
// 0.47.10（B-gm-000031）：H1 的 req:<ids> 认**任意形态**——此前只内嵌 legacy 三段（`R-gt-001`），
//   v2 号（`R-gm-47-0` / `B-gm-000028`）被当成「首行不合规范」，想按规范标注需求就提交不过。
import { REQ_ID_ANY_RE, REQ_ID_ANY_SRC, REQ_ID_RE } from "./reqid.mjs"; // 无锚点 id 体供 H1_RE 内嵌；REQ_ID_RE 供存量调用方

/** 提交 type 白名单（单一事实源） */
export const COMMIT_TYPES = ["feat", "fix", "docs", "refactor", "chore", "revert"];

/**
 * H1：`<type>(<scope>): <简述>`。scope 三种形态（形态已在正则内封闭，validateCommitMessage 不再重验）：
 *   ① 白名单关键词（design/req/task/…）；
 *   ② 需求归属 `req:<需求id>[,<需求id>]`（需求相关提交用它，替代单列「需求」trailer）——
 *      **两种 id 形态都收**：存量 `R-gt-001` / 新形态 `R-gm-30-0` 与 `B-gm-000004`（0.47.10 起）；
 *   ③ **席位归属 `seat:<席位id>`**（0.9.0 席位协作：席位在自己分支提交时用它——见 entry/workflow/seatflow.md §7）。
 */
export const H1_RE = new RegExp(
  `^(feat|fix|docs|refactor|chore|revert)\\((req:${REQ_ID_ANY_SRC}(?:,${REQ_ID_ANY_SRC})*|seat:[a-z][a-z0-9-]*|[a-z][a-z0-9-]*)\\): (\\S.*)$`,
);

/** 提交信息 trailer 顺序（单一事实源；`gd git commit` 与钩子共用） */
export const TRAILER_ORDER = ["任务", "提交人", "来源", "补丁", "版本", "gd版本"];

/** 首行摘要截断（H1 ≤ 72 字符口径的另一半：摘要段 ≤ 56 字符） */
function clipText(s, max = 56) {
  const arr = [...String(s ?? "").trim()];
  if (arr.length <= max) return arr.join("");
  return arr.slice(0, max - 1).join("") + "…";
}

export function buildCommitMessage({ type, scope, summary, body, trailers = {} }) {
  // 需求归属提到 H1（`<type>(req:R-x-001[,R-x-002]): …`），不再单列「需求」trailer
  const reqIds = Array.isArray(trailers.需求)
    ? trailers.需求.filter(Boolean)
    : String(trailers.需求 ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const effScope = reqIds.length > 0 ? `req:${reqIds.join(",")}` : scope;
  const lines = [`${type}(${effScope}): ${clipText(summary)}`];
  if (body) lines.push("", String(body).replace(/\s+$/, ""));
  const tLines = [];
  for (const k of TRAILER_ORDER) {
    const raw = trailers[k];
    const v = Array.isArray(raw) ? raw.filter(Boolean).join(", ") : raw;
    if (v !== undefined && v !== null && String(v).trim() !== "") tLines.push(`${k}: ${String(v).trim()}`);
  }
  if (tLines.length) lines.push("", ...tLines);
  return lines.join("\n") + "\n";
}

/** 校验 message 是否合规范（hook 与 CLI 共用同一套规则） */
export function validateCommitMessage(msg) {
  const errors = [];
  const lines = String(msg ?? "").replace(/\r\n/g, "\n").split("\n");
  const h1 = (lines[0] ?? "").replace(/\s+$/, "");
  const m = h1.match(H1_RE);
  if (!m) {
    errors.push(`首行不合规范（应为 <type>(<scope>): <标题正文>；需求相关 scope 写 req:<需求id>[,…]（如 req:R-gt-001 / req:R-gm-30-0 / req:B-gm-000004），席位相关写 seat:<席位id>）："${h1}"`);
  } else {
    if (!COMMIT_TYPES.includes(m[1])) errors.push(`type 非法 "${m[1]}"（可用：${COMMIT_TYPES.join(" / ")}）`);
    if (m[2].startsWith("req:")) {
      const ids = m[2].slice(4).split(",");
      // 形态已由 H1_RE 封闭，这里只是二次护栏：两处判据必须同一事实源（REQ_ID_ANY_RE），
      // 否则 H1_RE 放宽后这里会拿 legacy 单形态把新号再拒一次（B-gm-000031 的复发形态）。
      if (ids.some((id) => !REQ_ID_ANY_RE.test(id))) {
        errors.push(`需求 id 形态非法 "${m[2]}"（应为 req:R-gt-001 / req:R-gm-30-0 / req:B-gm-000004 之一，多个用英文逗号分隔）`);
      }
      if (new Set(ids).size !== ids.length) errors.push(`需求 id 重复："${m[2]}"`);
    } else if (!m[2].includes(":") && !COMMIT_SCOPES.includes(m[2])) {
      // 带 `:` 的 scope（req: / seat:）已在 H1_RE 内验过形态，只校白名单关键词
      errors.push(`scope 非法 "${m[2]}"（可用：${COMMIT_SCOPES.join(" / ")}；需求相关用 req:<需求id>[,…]）`);
    }
    if ([...h1].length > 72) errors.push(`首行过长（${[...h1].length} 字符 > 72）："${h1}"`);
  }
  const trailers = parseTrailers(lines);
  for (const k of TRAILER_REQUIRED) {
    if (!trailers[k]) errors.push(`缺少必需 trailer「${k}: 」（重要信息不得丢失）`);
  }
  return { ok: errors.length === 0, errors, trailers, h1, reqIds: reqIdsOf(h1) };
}

/**
 * 解析 message 中的 trailer 块 → Record<string,string>
 * 容错（.x 补）：允许 trailer 行前有空白——从终端/聊天粘贴多行 message 时常被自动缩进，
 * 旧口径会因此报“缺少必需 trailer”（实际已写），属假拒绝（用户实测 2026-09-16）。
 */
export function parseTrailers(textOrLines) {
  const lines = Array.isArray(textOrLines)
    ? textOrLines
    : String(textOrLines ?? "").replace(/\r\n/g, "\n").split("\n");
  const out = {};
  for (const line of lines) {
    const m = line.match(/^\s*([^\s:]+): (.*)$/);
    if (!m) continue;
    if (!TRAILER_ORDER.includes(m[1])) continue;
    out[m[1]] = m[2].trim();
  }
  return out;
}

/** 从 H1 抽需求归属 id（`<type>(req:R-x-001,R-x-002): …`）；非该形态返回 [] */
export function reqIdsOf(h1) {
  const m = H1_RE.exec(String(h1 ?? ""));
  if (!m || !m[2].startsWith("req:")) return [];
  return m[2].slice(4).split(",").filter(Boolean);
}

/** 打标签（已存在则跳过，不失败） */
export function tagRepo(repoDir, name, message) {
  if (!isRepo(repoDir)) return { ok: false, errors: [`目标目录不是独立 git 仓库根（拒绝打标签）：${repoDir}`] };
  const exists = runGit(repoDir, ["rev-parse", "-q", "--verify", `refs/tags/${name}`]).ok;
  if (exists) return { ok: true, skipped: true };
  const r = runGit(repoDir, ["tag", "-a", name, "-m", message || name]);
  if (!r.ok) return { ok: false, errors: [`git tag 失败：${r.stderr}`] };
  return { ok: true, skipped: false };
}

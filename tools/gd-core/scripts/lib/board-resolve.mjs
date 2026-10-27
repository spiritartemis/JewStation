/**
 * 板解析（board resolve）—— **唯一实现**：把「当前这块板在哪、叫什么、哪些执行体」问清楚。
 *
 * 0.19.0 C2 / 依赖层 = **core**（只依赖 node 内置 + `yaml.mjs` 基元；**不得 import 任何 app 层件**：
 *   席位 / 工作站 / 注册表 / manifest 一律不碰——app 侧通过 `registryLookup` 注入，见 §3）。
 *
 * 三级解析顺序（权威源 `docs/gd-core-session-workflow-design.md` §3.2）：
 *   ① `GD_BOARD` 环境变量 / 显式 `boardRoot`（最高优先，测试与本机临时切板用）
 *   ② **自举**：cwd 所在 git 工作区 → `<git-common-dir>/gdtwork/board.yaml`（缺省板根）→ `<git 顶层>/board.yaml`（`--in-tree` 摆法）
 *   ③ **app 注册表**：调用方注入 `registryLookup({ cwd })`（总控实现 = `projects/_registry.yaml` + `gd.layout.yaml`）
 *   三处都解析不到 ⇒ 返回 `null`（**不猜路径、不静默回退**；调用方据 `searched` 给出可操作报错）。
 *
 * 板根为何缺省放 `git-common-dir`：worktree 共享同一个 common dir ⇒ 并行会话看到**同一份 live 账**，
 *   且账永不参与提交 ⇒ 不存在账的合并冲突（设计 §3.1 板实分离）。
 *
 * 板与项目的区别（设计 §3）：core 只认板（账落点 + 编号命名空间）；「项目」= 注册表 + 能力 + 权限 + 席位，
 *   属 app 层包装。故本模块**不接受** `--project <id>` 这类概念，只认板根与板配置。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseYaml } from "./yaml.mjs";

/** 板配置文件名（板根下）；core 独有，不与 app 的 `gd.config.yaml` 打架 */
export const BOARD_FILE = "board.yaml";

/** 板配置 schema 版本（写侧只写这个值；读侧遇更高版本拒绝解析） */
export const BOARD_SCHEMA = 1;

/** 缺省板根目录名（放在 git-common-dir 下） */
export const DEFAULT_BOARD_DIR = "gdtwork";

/** 缺省执行体名（设计 §4：不复用历史包袱名 `main`） */
export const DEFAULT_EXECUTOR = "local";

/** 板 id 形态（= 编号命名空间：`R-<id>-001` 要求小写 kebab，与任务 id 正则一致） */
const BOARD_ID_RE = /^[a-z][a-z0-9-]*$/;

/** 显式板根环境变量 */
export const BOARD_ENV = "GD_BOARD";

/** 由目录（或任意路径）推出合法板 id：取 basename，非 kebab 字符转 `-`，小写，去首尾 `-` */
export function boardIdFromName(name) {
  const s = String(name ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return BOARD_ID_RE.test(s) ? s : null;
}

/**
 * 从 cwd 向上找 git 工作区信息（不 spawn git，纯读文件；worktree 感知）。
 * @returns {{top: string, gitDir: string, commonDir: string}|null}
 */
export function gitWorktreeInfo(cwd) {
  let dir = resolve(String(cwd ?? process.cwd()));
  for (;;) {
    const dotGit = join(dir, ".git");
    if (existsSync(dotGit)) {
      let gitDir = dotGit;
      // `.git` 是文件 ⇒ worktree / submodule（内容 `gitdir: <path>`）；是目录 ⇒ 普通仓
      if (statSync(dotGit, { throwIfNoEntry: false })?.isFile()) {
        // worktree / submodule：`.git` 是文件，内容 `gitdir: <path>`
        const txt = readFileSync(dotGit, "utf8");
        const m = txt.match(/^\s*gitdir:\s*(.+?)\s*$/m);
        if (!m) return null;
        gitDir = isAbsolute(m[1]) ? m[1] : resolve(dir, m[1]);
      }
      // common dir：worktree 的 gitdir 下有 `commondir` 文件（相对 gitdir）；普通仓 = gitdir 自身
      let commonDir = gitDir;
      const cdFile = join(gitDir, "commondir");
      if (existsSync(cdFile)) {
        const rel = readFileSync(cdFile, "utf8").trim();
        if (rel) commonDir = isAbsolute(rel) ? rel : resolve(gitDir, rel);
      }
      return { top: dir.split("\\").join("/"), gitDir: gitDir.split("\\").join("/"), commonDir: commonDir.split("\\").join("/") };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * 账根（0.23.0 B-gm-001）：**板账实际落点**——网页写面与轮询判据都得用它，不能拿项目根硬当账根。
 *
 *   · 缺省摆法（`gd core init` 默认）：`<git-common-dir>/gdtwork`（账不进工作区、不参与提交）；
 *   · in-tree 摆法：目录本身就是账根（`board.yaml` / `reqs/index.yaml` 与代码同仓）。
 * 两处都没有 ⇒ 原样返回入参（调用方按「这里没有板」自行报错，不猜路径）。
 * @param {string} dir 起点目录（项目根 / 任意子目录）
 * @returns {string} 账根（正斜杠）
 */
export function ledgerRootOf(dir) {
  const start = String(dir ?? ".");
  const info = gitWorktreeInfo(start);
  if (info) {
    const cand = join(info.commonDir, "gdtwork");
    if (existsSync(join(cand, "reqs", "index.yaml")) || existsSync(join(cand, BOARD_FILE))) return cand.split("\\").join("/");
  }
  return start.split("\\").join("/");
}

/** 读并规整板配置；文件缺失 ⇒ `{ present: false }`；解析失败 ⇒ `{ present: true, error }` */
export function readBoardConfig(root) {
  const path = join(String(root), BOARD_FILE);
  if (!existsSync(path)) return { present: false, root: String(root).split("\\").join("/"), path };
  let doc;
  try {
    doc = parseYaml(readFileSync(path, "utf8")) || {};
  } catch (e) {
    return { present: true, error: `board.yaml 解析失败：${e.message}`, root: String(root).split("\\").join("/"), path };
  }
  const b = doc.board ?? {};
  const id = String(b.id ?? "").trim();
  const errors = [];
  const schema = Number(doc.schema ?? 0);
  if (!schema) errors.push("缺 schema（当前 1）");
  else if (schema > BOARD_SCHEMA) errors.push(`schema ${schema} 高于本 CLI 支持的 ${BOARD_SCHEMA}（先升级 gd）`);
  if (!id) errors.push("缺 board.id（编号命名空间，如 gm）");
  else if (!BOARD_ID_RE.test(id)) errors.push(`board.id "${id}" 非法（小写 kebab，与 R-<id>-001 同形）`);
  const executors = (Array.isArray(doc.executors) ? doc.executors : [])
    .map((e) => (typeof e === "string" ? { id: e } : { id: String(e?.id ?? "").trim(), note: e?.note }))
    .filter((e) => e.id);
  if (executors.some((e) => !BOARD_ID_RE.test(e.id))) errors.push("executors[].id 非法（小写 kebab）");
  const ids = executors.map((e) => e.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) errors.push(`executors 重复：${[...new Set(dup)].join(" / ")}`);
  return {
    present: true,
    path: path.split("\\").join("/"),
    root: String(root).split("\\").join("/"),
    schema,
    id: id || null,
    name: String(b.name ?? "").trim() || null,
    repo: doc.repo ? String(doc.repo).trim().split("\\").join("/") : null,
    executors: executors.length ? executors : [{ id: DEFAULT_EXECUTOR, note: "缺省（board.yaml 未列 executors）" }],
    // 模式不手写：由数据事实派生（seats/index.yaml 存在 = 席位语义）
    mode: existsSync(join(String(root), "seats", "index.yaml")) ? "seat" : "session",
    errors,
    error: errors.length ? errors.join("；") : undefined,
  };
}

/**
 * 解析当前板（三级顺序；纯读，无副作用）。
 * @param {object} [o]
 * @param {string} [o.cwd] 起始目录（缺省 process.cwd()）
 * @param {object} [o.env] 环境变量（缺省 process.env）
 * @param {string} [o.boardRoot] 显式板根（等价 `GD_BOARD`，优先于环境变量）
 * @param {(o:{cwd:string, git:object|null})=>string|null} [o.registryLookup] app 层注入（总控实现 = 项目注册表）
 * @returns {{board: object|null, source: "arg"|"env"|"self"|"registry"|null, git: object|null, searched: string[]}}
 */
export function resolveBoard({ cwd = process.cwd(), env = process.env, boardRoot = null, registryLookup = null } = {}) {
  const searched = [];
  const git = gitWorktreeInfo(cwd);

  // ① 显式：参数 > 环境变量
  const explicit = boardRoot || (env && env[BOARD_ENV]) || null;
  if (explicit) {
    const root = isAbsolute(String(explicit)) ? String(explicit) : resolve(cwd, String(explicit));
    searched.push(`显式板根 ${root}`);
    const cfg = readBoardConfig(root);
    if (cfg.present) return { board: cfg, source: boardRoot ? "arg" : "env", git, searched };
  }

  // ② 自举：<git-common-dir>/gdtwork 缺省板根 → <git 顶层>/board.yaml（--in-tree）
  if (git) {
    const cands = [join(git.commonDir, DEFAULT_BOARD_DIR), git.top];
    for (const root of cands) {
      searched.push(`自举 ${root}`);
      const cfg = readBoardConfig(root);
      if (cfg.present) return { board: cfg, source: "self", git, searched };
    }
  }

  // ③ app 注入：注册表（core 不认「项目 id」，只收注入结果）
  if (typeof registryLookup === "function") {
    searched.push("app 注册表注入");
    const root = registryLookup({ cwd, git });
    if (root) {
      const cfg = readBoardConfig(root);
      if (cfg.present) return { board: cfg, source: "registry", git, searched };
    }
  }

  return { board: null, source: null, git, searched };
}

/**
 * 交付件路径基准（0.19.0 C6 · 设计 §9 泄漏点 ③）：**板实分离时以 `repo` 为根**。
 * 现状：seat 模式的交付件登记相对「项目库根」（`seatartifact.mjs` 口径）；板模式板根在 `.git/` 下、
 *   件在代码仓里 —— 若仍按板根解析，校验必报「件不存在」。
 * @param {string} root 板根 / 项目库根
 * @returns {string} 交付件字节基准目录
 */
export function artifactBasis(root) {
  const cfg = readBoardConfig(root);
  if (cfg.present && !cfg.error && cfg.repo) return cfg.repo;
  return String(root);
}

/** 解析失败时的人读报错（各命令共用一份措辞，避免各写一套） */
export function boardMissingHint(searched = []) {
  return [
    "未定位到板（board）——gd 核心工作流的账落在板上，不在仓库里",
    `  · 本仓自举：在仓库根跑 gd core init（建 <git-common-dir>/${DEFAULT_BOARD_DIR}/board.yaml + 基线 tag）`,
    `  · 临时切板：export ${BOARD_ENV}=<板根目录>`,
    "  · 注册项目（app 层）：gd project current <项目id>",
    // 0.21.15（R-gm-039）：cwd 指向**已删除目录**是「刚 land 回收了工作区」的典型症状
    ...(cwdGone() ? ["  · 当前目录已不存在（多半是刚 gd work land 回收了工作区）——cd 回仓库根目录再试"] : []),
    ...(searched.length ? [`  · 已尝试：${searched.join(" / ")}`] : []),
  ].join("\n");
}
/** 当前目录是否已被删除（cwd 悬空）——0.21.15 症状识别 */
function cwdGone() {
  try {
    return !existsSync(process.cwd());
  } catch {
    return true;
  }
}

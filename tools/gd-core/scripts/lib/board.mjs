/**
 * board.mjs — 轻协议账本读写层（两账 · 一操作台）
 *
 * 两个账件（其余散账全部消失）：
 *   ① 任务账 `reqs/<R-id>/task-list.yaml`（schema v4：任务 + `artifacts` + `review` 三段内联）
 *   ② 执行事件流 `reqs/<R-id>/events.jsonl`（需求内分片）+ `events.jsonl`（项目级，无任务归属）
 *
 * 单一写入口：一切写操作过 `withBoardLock`（进程锁）+ `writeFileAtomic`（原子落盘）；
 *   远程多人并发用乐观锁（`fileRevision` 比对，冲突即 `E_CONFLICT`，由调用方重放）。
 * 状态机（一套 4 态）：`ready → in_progress → review → done`（review 打回 → in_progress；in_progress 回退 → ready）。
 * "未派 / 已派"不是状态——由任务 `executor` 是否为空表达（空 = 未派，仍在待办队列）。
 * 单一事实源：状态枚举 / 流转表 / 需求态派生 / 事件 kind 只在本文件，勿在别处再写一份。
 *
 * 规范见 entry/workflow/reqflow.md · JSON Schema：blueprint/schemas/task-list.schema.json ·
 *   blueprint/schemas/events.schema.json
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { parseYaml, unquoteScalar } from "./yaml.mjs";
import { isReqDir, isReqIdV2, subverAliasOf } from "./reqid.mjs"; // 0.23.0 R-gm-061：需求目录形态（R- / B-）单一事实源；0.28.2 R-gm-090：新形态 id ⇒ 子版坐标
import { BOARD_FILE } from "./board-resolve.mjs"; // 0.28.2 R-gm-090：板根的判别牌（项目账没有 board.yaml）
import { readSubvers, writeSubvers } from "./subvers.mjs"; // 0.28.2 R-gm-090：需求验收 ⇒ 自动结子版
import { normalizeWorkUnits } from "./workunit.mjs"; // 0.41：工作单元（work_units）的规整（账读面）
import { DEP_KEY, depLines, normalizeDeps } from "./reqdep.mjs"; // 0.47 R-gm-104：依赖边（depends_on）的账模型与归一
import { snapshot, snapshotEnabled } from "./board-vcs.mjs"; // 0.21.8：账库快照（尽力而为）
import {
  TASK_STATES,
  LEGACY_TASK_STATUS_MAP,
  V4_TASK_STATUS_MAP,
  LEGACY_UNASSIGNED_STATES,
  reqStatusOfLedger,
} from "./taskstates.mjs";

/** 4 态词表与派生规则的**唯一实现**在 `lib/taskstates.mjs`（0.16.7 · 纯函数，工位台侧也直接引它）。
 *  本模块转出同一份，对外 API 与历史一致——写面留在本模块，规则不重写。
 *  上面的 import 只取**本模块自己要用**的那几个名字，其余（`deriveTaskState` 等）纯转出。 */
export {
  TASK_STATES,
  STATE_LABELS,
  LEGACY_TASK_STATUS_MAP,
  V4_TASK_STATUS_MAP,
  LEGACY_UNASSIGNED_STATES,
  deriveTaskState,
  deriveReqState,
  reqStatusOfLedger,
  countTasks,
} from "./taskstates.mjs";

// ── 常量（单一事实源） ───────────────────────────────────────

/** 任务账 schema 版本（v5 = 4 态状态机；v4 = artifacts / review 内联） */
export const BOARD_SCHEMA_VERSION = 5;

/** 合法流转表（`done → in_progress` = 验收后返工重开；`in_progress → ready` = 回退待办并清空派单目标） */
export const TASK_TRANSITIONS = {
  // 0.24.2 R-gm-087：`review` 这条边是**交件合一跃迁**——新任务可直接交件进验收窗口（不再强制「先 in_progress 再交一次」）
  ready: ["in_progress", "review"],
  in_progress: ["review", "ready"],
  review: ["done", "in_progress"],
  done: ["in_progress"],
};

export const LEGACY_REQ_STATUS_MAP = {
  new: "ready",
  in_progress: "in_progress",
  completed: "review",
  verified: "done",
};

/** 事件 kind（handoff 字段严格对齐「最小交接信息」：done / remain / decision / next） */
export const EVENT_KINDS = ["dispatch", "claim", "release", "progress", "handoff", "deliver", "review", "note"];

/** 事件 kind 中文标签（渲染用；键集须与 EVENT_KINDS 一致） */
export const EVENT_LABELS = {
  dispatch: "派单",
  claim: "认领",
  release: "交还",
  progress: "进展",
  handoff: "交接",
  deliver: "交件",
  review: "验收",
  note: "备注",
};
export const HANDOFF_FIELDS = ["done", "remain", "decision", "next"];

/**
 * 旧账目录 / 文件（迁移时整体移入 `.legacy/`，不删）。
 * **例外**：`status.yaml`（席位阶段态——本机席位 `branch: null` 的工作位就是项目库目录，是**活文件**）
 * 只读不迁：`gd migrate` 会读它补一次事件留痕（幂等），但不归档、不删。
 * `intents/`（网页意图转接器）随意图轨于 0.14.6 退役，已按普通旧账列入本表——不再有消费方。
 */
export const LEGACY_LEDGERS = [
  "commands",
  "claims",
  "intents",
  "requests",
  "reviews",
  "deliverables",
  "dispatch-log.yaml",
  "versions.yaml",
  "routing.log",
];

// ── 路径 ────────────────────────────────────────────────────

export function reqDirOf(projDir, reqId) {
  return join(projDir, "reqs", reqId);
}
export function taskLedgerPath(projDir, reqId) {
  return join(reqDirOf(projDir, reqId), "task-list.yaml");
}
/** 事件流分片路径：reqId 为空 → 项目级 `events.jsonl` */
export function eventsPathOf(projDir, reqId) {
  return reqId ? join(reqDirOf(projDir, reqId), "events.jsonl") : join(projDir, "events.jsonl");
}
export function reqIndexPath(projDir) {
  return join(projDir, "reqs", "index.yaml");
}
export function boardLockPath(projDir) {
  return join(projDir, ".gd", "board.lock");
}
export function legacyDirOf(projDir) {
  return join(projDir, ".legacy");
}

/** 列项目内需求 id（按目录名排序；无 reqs/ 返回 []） */
export function listReqIds(projDir) {
  const d = join(projDir, "reqs");
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((n) => isReqDir(n))
    .sort();
}

/** ISO-8601 时间戳（UTC，秒精度；与仓内其余时间戳同形） */
export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ── 乐观锁 / 原子写 ─────────────────────────────────────────

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** 文件版本令牌（mtime+size+内容哈希）；文件不存在返回 null。写前比对即乐观锁 */
export function fileRevision(path) {
  if (!existsSync(path)) return null;
  const st = statSync(path);
  return `${st.mtimeMs}-${st.size}-${sha256(readFileSync(path)).slice(0, 12)}`;
}

export class BoardConflictError extends Error {
  constructor(path, actual, expected) {
    super(`账本已被他人改写（E_CONFLICT）：${path}\n  期望版本 ${expected ?? "(空)"} · 实际 ${actual ?? "(空)"}`);
    this.name = "BoardConflictError";
    this.code = "E_CONFLICT";
    this.path = path;
  }
}

/**
 * 快照校验：客户端**读到的**版本与服务端当前账不一致 → E_CONFLICT。
 * 与 `writeFileAtomic` 的 expectedRev 不同——那是「读后立即写」的自校验；本函数用于
 * **远程多人**场景下把「用户看到的看板版本」带到写面，防止基于旧快照的覆盖写（设计 §10 并发写对策）。
 * 空值（undefined / null / ""）视为「不带快照」= 放行（单机 / CLI 直写不付这个成本）。
 */
export function assertRevision(path, current, expected) {
  if (expected === undefined || expected === null || expected === "") return;
  if (String(expected) !== String(current ?? "")) throw new BoardConflictError(path, current, expected);
}

/**
 * 全账版本令牌（任务账 revision + 事件流文件指纹的哈希）：
 *   **实时刷新**（SSE）用它判「变没变」；前端把它当作看板快照版本（乐观锁提示文案也用得上）。
 * 不做 IO 以外的开销：一次目录遍历 + 每需求一次读账（看板本来就要读）。
 */
export function boardRevision(projDir) {
  const parts = [];
  for (const reqId of listReqIds(projDir)) {
    const l = readTaskLedger(projDir, reqId);
    parts.push(`${reqId}:${l.revision ?? "-"}`);
    const ep = eventsPathOf(projDir, reqId);
    if (existsSync(ep)) {
      const st = statSync(ep);
      parts.push(`${reqId}#e:${st.mtimeMs}-${st.size}`);
    }
  }
  const gp = eventsPathOf(projDir, null);
  if (existsSync(gp)) {
    const st = statSync(gp);
    parts.push(`global#e:${st.mtimeMs}-${st.size}`);
  }
  return sha256(parts.sort().join("|")).slice(0, 16);
}

/**
 * 原子写（同目录临时文件 + rename）。传 `expectedRev` 时先做乐观锁比对，冲突抛 E_CONFLICT。
 * @param {string} path
 * @param {string} text
 * @param {{expectedRev?: string|null, force?: boolean}} [opts]
 */
export function writeFileAtomic(path, text, { expectedRev, force = false } = {}) {
  if (!force && expectedRev !== undefined) {
    const cur = fileRevision(path);
    if (cur !== expectedRev) throw new BoardConflictError(path, cur, expectedRev);
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, text, "utf8");
  try {
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* 临时文件已被清理 */
    }
    throw e;
  }
}

// ── 单写入口锁（进程锁） ────────────────────────────────────

export class BoardLockBusyError extends Error {
  constructor(path, timeoutMs) {
    super(`账本锁被占用（E_LOCK_BUSY）：${path} 超过 ${timeoutMs}ms 未释放`);
    this.name = "BoardLockBusyError";
    this.code = "E_LOCK_BUSY";
  }
}

/** 同步睡眠（Node 无 sleepSync；Atomics.wait 阻塞主线程） */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 单一写入口：持锁执行 fn（退出即释放，异常也释放）。
 * 锁文件 = `.gd/board.lock`（`wx` 独占创建）；超时视为陈旧锁（默认 60s）自动接管。
 * @template T
 * @param {string} projDir
 * @param {() => T} fn
 * @param {{timeoutMs?: number, staleMs?: number, pollMs?: number, label?: string, snapshot?: boolean}} [opts]
 *   `snapshot: false` = 本次写入**不打快照**（观测类旁证数据用：见 decision-trace 的说明）
 * @returns {T}
 */
/** 本进程已持有的锁（按锁文件路径）——用于**同进程重入**：updateIndex 常在 applyTransition 的锁内被调用 */
const heldLocks = new Set();

export function withBoardLock(projDir, fn, { timeoutMs = 5000, staleMs = 60000, pollMs = 40, label = "写账", snapshot: doSnapshot = true } = {}) {
  const boardWriteLabel = String(label ?? "写账");
  const p = boardLockPath(projDir);
  if (heldLocks.has(p)) return fn(); // 重入：同一进程已持锁，直接执行（锁不可重入会自锁死）
  mkdirSync(dirname(p), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      writeFileSync(p, JSON.stringify({ pid: process.pid, at: nowIso() }), { flag: "wx" });
      break;
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
      if (Date.now() - statSync(p).mtimeMs > staleMs) {
        try {
          unlinkSync(p); // 陈旧锁（进程已死）：接管
        } catch {
          /* 他人已释放 */
        }
        continue;
      }
      if (Date.now() >= deadline) throw new BoardLockBusyError(p, timeoutMs);
      sleepSync(pollMs);
    }
  }
  heldLocks.add(p);
  try {
    const result = fn();
    // 0.21.8：账库存在时，落盘后打一版快照（**锁内** ⇒ 天然串行，不会争 git index）。
    //   尽力而为：快照失败绝不影响本次写入。
    //   B-gm-000011：观测类写入显式 `snapshot: false`——一次派单本来就有一次账快照，
    //   再为旁证数据多打一版会让 `gd core snap --log` 被「决策观测」刷屏，且每次多 3 个 git 子进程。
    //   不打的文件不会丢：下一次任何账写入的 `git add -A` 会把它一起收进那一版快照。
    if (doSnapshot && snapshotEnabled(projDir)) {
      try {
        snapshot(projDir, `board: ${new Date().toISOString()} · ${boardWriteLabel}`);
      } catch {
        /* 账写入优先 */
      }
    }
    return result;
  } finally {
    heldLocks.delete(p);
    try {
      unlinkSync(p);
    } catch {
      /* 已被陈旧锁接管逻辑清掉 */
    }
  }
}

// ── 任务账：读 ──────────────────────────────────────────────

/** 任务归一（旧账 → 当前 schema）：`agent` → `executor`，按来源版本选状态映射表，未知字段原样保留 */
/**
 * 账内「结构化块」读取（`claim` / `work` / `submitted` / `landed` 这类非约定字段）。
 *
 * 为什么需要它：任务账序列化器对**非契约字段**走内联 JSON 标量（`claim: {"session":…}`），
 *   YAML 解析回来是字符串而不是对象 ⇒ 读侧必须再解一次；两种形态（字符串 / 已是对象）都要认。
 * 单一实现放这里：`lib/workclaim.mjs: claimOf` 与 `scripts/work.mjs` 的任务块读取共用同一口径。
 * @param {unknown} value 字段原始值
 * @returns {object|null} 解析出的对象；非对象 / 坏 JSON ⇒ null
 */
export function ledgerBlock(value) {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}

function normalizeTask(t, schemaVersion) {
  const out = { ...t };
  const uq = (v) => (typeof v === "string" ? unquoteScalar(v) : v);
  out.id = String(t.id ?? "");
  out.title = uq(String(t.title ?? ""));
  out.executor = uq(String(t.executor ?? t.agent ?? ""));
  const raw = String(t.status ?? "");
  const stale = schemaVersion < BOARD_SCHEMA_VERSION;
  const map = schemaVersion >= 4 ? V4_TASK_STATUS_MAP : LEGACY_TASK_STATUS_MAP;
  out.status = stale ? map[raw] ?? raw : raw;
  // 旧「未派」态（v3 `new` / v4 `backlog`）合并进 ready 后，目标须清空才算真未派
  if (stale && LEGACY_UNASSIGNED_STATES.includes(raw)) out.executor = "";
  // 旧账的 `agent` 已折进 `executor`：删掉重名键，免得升级落盘时当“未知字段”尾随保留
  if (stale) delete out.agent;
  out.artifacts = Array.isArray(t.artifacts) ? t.artifacts.filter((a) => a && a.path) : [];
  out.review = t.review && typeof t.review === "object" && !Array.isArray(t.review) ? t.review : null;
  // 0.44：任务标签（缺省 task；acceptance = 需求级验收任务——只是标签，不改 4 态机）
  out.kind = String(t.kind ?? "").trim() === "acceptance" ? "acceptance" : "";
  // 0.47 R-gm-104：依赖边（同需求内）。读侧恒为数组（无依赖 = `[]`），手写 `[T-x]` 由 normalizeDeps 归一成 `{id}`。
  //   写侧空数组**不落盘**（serializeTaskLedger 显式跳过）：「读侧稳定形状 / 文件侧不留噪音」两件事分开。
  out.depends_on = normalizeDeps(t.depends_on);
  return out;
}

/**
 * 乐观锁冲突自动重放（0.19.0 C4）：写操作都是「读-改-写」短事务，撞上并发写（E_CONFLICT）时重放即可，
 *   不必让调用方看到一次短暂竞态。**只对冲突重放**——其它错误原样抛出（不吞）。
 * @template T
 * @param {() => T} fn 每次调用都要自己重新读账（不得复用上一次读到的 revision）
 * @param {{attempts?: number, onRetry?: (n: number, e: Error) => void}} [opts]
 * @returns {T}
 */
export function withConflictRetry(fn, { attempts = 3, onRetry = null } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (e) {
      const conflict = !!e && (e.code === "E_CONFLICT" || /E_CONFLICT/.test(String(e.message ?? "")));
      if (!conflict) throw e;
      lastErr = e;
      if (typeof onRetry === "function") onRetry(i + 1, e);
    }
  }
  throw lastErr;
}

/**
 * 读任务账。账不存在 → `{ missing: true, tasks: [] }`；v3 账按旧状态映射归一（只读，不改盘）。
 * @param {string} projDir
 * @param {string} reqId
 */
export function readTaskLedger(projDir, reqId) {
  const path = taskLedgerPath(projDir, reqId);
  if (!existsSync(path)) return { req: reqId, schemaVersion: 0, tasks: [], workUnits: [], path, revision: null, missing: true };
  const doc = parseYaml(readFileSync(path, "utf8")) || {};
  const schemaVersion = Number(doc.schema_version) || 0;
  const tasks = (Array.isArray(doc.tasks) ? doc.tasks : []).filter((t) => t && t.id).map((t) => normalizeTask(t, schemaVersion));
  // 0.41：工作单元（顶层 `work_units`）——**可选**：缺省 = 没有工作单元（存量需求不受影响）
  const workUnits = normalizeWorkUnits(doc.work_units);
  return { req: String(doc.req ?? reqId), schemaVersion, tasks, workUnits, path, revision: fileRevision(path), missing: false };
}

/** 读全部需求的任务账（键 = 需求 id） */
export function readAllLedgers(projDir) {
  const out = new Map();
  for (const reqId of listReqIds(projDir)) out.set(reqId, readTaskLedger(projDir, reqId));
  return out;
}

/** 按 id 找任务（跨需求）：返回 `{ reqId, task }`；未找到返回 null */
export function findTaskAnywhere(projDir, taskId) {
  for (const [reqId, ledger] of readAllLedgers(projDir)) {
    const task = ledger.tasks.find((t) => t.id === taskId);
    if (task) return { reqId, task };
  }
  return null;
}

// ── 任务账：写 ──────────────────────────────────────────────

/** 标量落值（含注释符 / 行首引号时加双引号，读侧 unquoteScalar 归一） */
function scalar(v) {
  const s = String(v ?? "");
  return /\s#|^["']/.test(s) ? `"${s.replace(/"/g, "'")}"` : s;
}

/** 多行文本 → 字面块行（缩进 indent）；空值返回 []（不写该键） */
function blockLines(key, text, indent) {
  const body = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+$/, "");
  if (body.trim() === "") return [];
  const pad = " ".repeat(indent);
  return [`${pad}${key}: |`, ...body.split("\n").map((l) => (l === "" ? "" : `${pad}  ${l}`))];
}


const TASK_KEY_ORDER = ["id", "title", "executor", "status", "created", "kind", "input", "artifacts", "traces", "review", "work_unit", DEP_KEY];

/**
 * 工作单元 → YAML 行（**顶层块**，0.41 新增）。
 * @param {object[]} units
 * @returns {string[]}
 */
function workUnitLines(units) {
  if (!units.length) return [];
  const lines = ["work_units:"];
  for (const u of units) {
    lines.push(`  - id: ${scalar(u.id)}`);
    if (u.executor) lines.push(`    executor: ${scalar(u.executor)}`);
    if (u.branch) lines.push(`    branch: ${scalar(u.branch)}`);
    if (u.path) lines.push(`    path: ${scalar(u.path)}`);
    if (u.base) lines.push(`    base: ${scalar(u.base)}`);
    if (u.repo) lines.push(`    repo: ${scalar(u.repo)}`);
    if (u.started) lines.push(`    started: ${scalar(u.started)}`);
    if (u.session) lines.push(`    session: ${scalar(u.session)}`);
    const ts = Array.isArray(u.tasks) ? u.tasks.filter(Boolean) : [];
    if (ts.length) lines.push(`    tasks: [${ts.map((t) => scalar(t)).join(", ")}]`);
  }
  return lines;
}


/**
 * 任务账 → YAML 文本（字段顺序固定：id/title/executor/status/created/input/artifacts/review，未知字段尾随）。
 * @param {{req: string, tasks: object[], work_units?: object[]}} doc
 */
export function serializeTaskLedger(doc) {
  const tasks = doc.tasks ?? [];
  const units = Array.isArray(doc.work_units) ? doc.work_units : [];
  const lines = [
    `# 任务账（v${BOARD_SCHEMA_VERSION}）— 需求级单一事实源：任务 / 交付件（artifacts）/ 验收（review）内联`,
    "# 规范见 entry/workflow/reqflow.md · JSON Schema：blueprint/schemas/task-list.schema.json",
    `# 状态机：${TASK_STATES.join(" → ")}（review 打回 → in_progress · in_progress 回退 → ready）`,
    "# 「未派 / 已派」由 executor 是否为空表达（空 = 未派，仍在待办队列）",
    "# 工作单元（work_units · 0.41）：一个（执行体 × 需求）一棵工作树 + 一条分支；任务用 work_unit 引用它",
    "",
    `req: ${doc.req}`,
    `schema_version: ${BOARD_SCHEMA_VERSION}`,
    ...workUnitLines(units),
    tasks.length === 0 ? "tasks: []" : "tasks:",
  ];
  for (const t of tasks) {
    lines.push(`  - id: ${t.id}`);
    if (t.title) lines.push(`    title: ${scalar(t.title)}`);
    if (t.executor) lines.push(`    executor: ${scalar(t.executor)}`);
    lines.push(`    status: ${t.status}`);
    if (t.created) lines.push(`    created: ${t.created}`);
    if (t.kind) lines.push(`    kind: ${scalar(t.kind)}`);
    if (t.work_unit) lines.push(`    work_unit: ${scalar(t.work_unit)}`);
    // 0.47 R-gm-104：依赖边（同需求内）显式写块，不交给「未知字段尾随」——
    //   尾随分支会把数组写成单行 JSON（人不可读），且空数组不在它跳过的取值里 ⇒ 会写出 `depends_on: []`。
    lines.push(...depLines(t.depends_on, 4));
    lines.push(...blockLines("input", t.input, 4));
    const artifacts = Array.isArray(t.artifacts) ? t.artifacts : [];
    if (artifacts.length > 0) {
      lines.push("    artifacts:");
      for (const a of artifacts) {
        lines.push(`      - path: ${scalar(a.path)}`);
        if (a.kind) lines.push(`        kind: ${scalar(a.kind)}`);
        if (a.checksum) lines.push(`        checksum: ${scalar(a.checksum)}`);
        if (a.seat) lines.push(`        seat: ${scalar(a.seat)}`);
        if (a.desc) lines.push(...blockLines("desc", a.desc, 8));
        if (a.at) lines.push(`        at: ${scalar(a.at)}`);
        // B-gm-000004：失效标记必须落盘——漏写会让「已顶掉的旧条目」在读侧复活（旧指纹参与验收复算）
        if (a.superseded === true || a.superseded === "true") {
          lines.push("        superseded: true");
          if (a.superseded_at) lines.push(`        superseded_at: ${scalar(a.superseded_at)}`);
        }
      }
    }
    // 0.33.1 R-gm-33-1：决策 trace 关联（这条活依据了哪条建议）——验收时按它对账回填后验标签
    const traces = Array.isArray(t.traces) ? t.traces : [];
    if (traces.length > 0) {
      lines.push("    traces:");
      for (const tr of traces) {
        lines.push(`      - id: ${scalar(tr.id)}`);
        if (tr.at) lines.push(`        at: ${scalar(tr.at)}`);
        if (tr.by) lines.push(`        by: ${scalar(tr.by)}`);
      }
    }
    if (t.review && typeof t.review === "object") {
      lines.push("    review:");
      if (t.review.verdict) lines.push(`      verdict: ${t.review.verdict}`);
      if (t.review.by) lines.push(`      by: ${scalar(t.review.by)}`);
      if (t.review.at) lines.push(`      at: ${scalar(t.review.at)}`);
      // 0.33.1：验收人声明「业务结论推翻了决策建议」——必须落盘，否则事后无从分辨 overridden 标签的来由
      if (t.review.decision_overridden === true) lines.push("      decision_overridden: true");
      lines.push(...blockLines("note", t.review.note, 6));
      // B-gm-000004：`--force` 覆盖项留痕（漏写 = 覆盖通道变成无记录的后门）
      const ovr = Array.isArray(t.review.artifact_override) ? t.review.artifact_override : [];
      if (ovr.length > 0) {
        lines.push("      artifact_override:");
        for (const o of ovr) {
          lines.push(`        - path: ${scalar(o.path)}`);
          if (o.recorded) lines.push(`          recorded: ${scalar(o.recorded)}`);
          lines.push(`          current: ${o.current ? scalar(o.current) : "null"}`);
        }
      }
    }
    // 未知字段尾随（不丢数据）：标量直写，对象/数组以 JSON 单行落（本仓 yaml 子集不覆盖嵌套自由结构）
    for (const [k, v] of Object.entries(t)) {
      if (TASK_KEY_ORDER.includes(k) || v === undefined || v === null || v === "") continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") lines.push(`    ${k}: ${scalar(v)}`);
      else lines.push(`    ${k}: ${JSON.stringify(v)}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * 写任务账（原子 + 可选乐观锁）。调用方**必须**已在 `withBoardLock` 内，或用 `mutateTaskLedger`。
 * @returns {{path: string, revision: string|null}}
 */
export function writeTaskLedger(projDir, reqId, doc, { expectedRev } = {}) {
  const path = taskLedgerPath(projDir, reqId);
  // 0.41：work_units 是**需求级**账目 —— 调用方**没显式给**时保留文件里现有的。
  //   （不这么做：任何一次写任务（认领 / 交付件 / 删任务…）都会把工作单元悄悄抹掉 ⇒ 同需求第二个任务
  //     找不到单元 ⇒ 又开一棵工作树。工作单元的增删只由显式传 work_units 的调用方决定。）
  let units = Array.isArray(doc.work_units) ? doc.work_units : undefined;
  if (units === undefined) {
    try {
      const cur = parseYaml(readFileSync(path, "utf8")) || {};
      units = Array.isArray(cur.work_units) ? cur.work_units : [];
    } catch {
      units = [];
    }
  }
  writeFileAtomic(path, serializeTaskLedger({ ...doc, req: doc.req ?? reqId, work_units: units }), { expectedRev });
  return { path, revision: fileRevision(path) };
}

/**
 * 账本变更的唯一入口：持锁 → 读 → mutator 改写 → 写回（乐观锁比对读时版本）。
 * mutator 抛错则不落盘（异常向上抛）。
 * @param {string} projDir
 * @param {string} reqId
 * @param {(ledger: object) => (object|void)} mutator 就地改写或返回新账
 * @returns {object} 落盘后的账
 */
export function mutateTaskLedger(projDir, reqId, mutator, { expectedRev } = {}) {
  return withBoardLock(projDir, () => {
    const before = readTaskLedger(projDir, reqId);
    assertRevision(before.path, before.revision, expectedRev);
    const next = mutator(before) ?? before;
    // 0.41：工作单元随账一起写回（缺省 = 保留原样）
    writeTaskLedger(
      projDir,
      reqId,
      { req: next.req ?? reqId, tasks: next.tasks, work_units: next.workUnits ?? before.workUnits ?? [] },
      { expectedRev: before.revision }
    );
    return readTaskLedger(projDir, reqId);
  });
}

// ── 状态机 ──────────────────────────────────────────────────

export function isTaskState(s) {
  return TASK_STATES.includes(String(s));
}

/** 流转是否合法（`from → to`）；同态不算合法流转 */
export function canTransition(from, to) {
  return (TASK_TRANSITIONS[from] ?? []).includes(to);
}

// ── 事件流 ──────────────────────────────────────────────────

/** 事件归一 + 校验：必填 kind（白名单）/ actor；可带 task / text / route / state */
export function normalizeEvent(e, { reqId = null } = {}) {
  const kind = String(e?.kind ?? "");
  if (!EVENT_KINDS.includes(kind)) throw new Error(`事件 kind 非法："${kind}"（可用：${EVENT_KINDS.join(" / ")}）`);
  if (!e?.actor) throw new Error("事件缺少 actor（谁做的）");
  const out = { seq: Number(e.seq) || 0, at: e.at ? String(e.at) : nowIso(), actor: String(e.actor), kind };
  if (e.task) out.task = String(e.task);
  if (e.to) out.to = String(e.to);
  if (e.route) out.route = String(e.route);
  if (e.state) out.state = String(e.state);
  if (e.text) out.text = String(e.text);
  for (const f of HANDOFF_FIELDS) if (e[f] !== undefined && e[f] !== null) out[f] = e[f];
  if (e.consumed_at) out.consumed_at = String(e.consumed_at);
  if (reqId) out.req = reqId;
  for (const [k, v] of Object.entries(e)) {
    if (!(k in out) && v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

/** 读事件流（坏行跳过：只追加账不因半截行炸读侧）；按 seq 升序 */
export function readEvents(projDir, reqId = null) {
  const p = eventsPathOf(projDir, reqId);
  if (!existsSync(p)) return [];
  const out = [];
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t);
      if (e && typeof e === "object") out.push({ seq: Number(e.seq) || 0, ...e });
    } catch {
      /* 半截/损坏行跳过 */
    }
  }
  return out.sort((a, b) => a.seq - b.seq);
}

/** 下一个事件号（需求内自增；项目级同理） */
export function nextEventSeq(projDir, reqId = null) {
  return readEvents(projDir, reqId).reduce((m, e) => Math.max(m, Number(e.seq) || 0), 0) + 1;
}

/**
 * 追加事件（只追加；号在同一文件内自增）。调用方须在 `withBoardLock` 内。
 * @param {string} projDir
 * @param {string|null} reqId
 * @param {object[]} entries 事件（seq 由本函数分配；at 缺省填当前时间）
 * @returns {object[]} 落盘的事件（含 seq）
 */
export function appendEvents(projDir, reqId, entries) {
  const rows = [];
  let seq = nextEventSeq(projDir, reqId);
  for (const e of entries ?? []) rows.push(normalizeEvent({ ...e, seq: seq++ }, { reqId }));
  if (rows.length === 0) return [];
  const p = eventsPathOf(projDir, reqId);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return rows;
}

/**
 * 全局事件视图：项目级 + 各需求分片按 `at`（同刻按 seq）归并。
 * @param {string} projDir
 * @param {{reqIds?: string[]}} [opts] reqIds 限定分片（缺省 = 全部需求）
 */
export function readAllEvents(projDir, { reqIds } = {}) {
  const ids = reqIds ?? listReqIds(projDir);
  const rows = [...readEvents(projDir, null)];
  for (const reqId of ids) rows.push(...readEvents(projDir, reqId));
  return rows.sort((a, b) => String(a.at).localeCompare(String(b.at)) || (a.seq ?? 0) - (b.seq ?? 0));
}

// ── 需求索引（status/task_count/task_done 为派生缓存） ──────

/** 读需求索引条目（含 `versions:` 等未知字段原样保留） */
export function readReqEntries(projDir) {
  const p = reqIndexPath(projDir);
  if (!existsSync(p)) return [];
  const doc = parseYaml(readFileSync(p, "utf8")) ?? {};
  const list = (Array.isArray(doc.requirements) ? doc.requirements : []).filter((r) => r && r.id);
  // 0.47 R-gm-104：需求条目的依赖边（跨需求）读侧归一（恒为数组，手写 `[R-x]` 归一成 `{id}`）。
  //   ⚠️ 与 `reqflow.mjs: readIndex()` 是两个读点（反向 import 会成环）⇒ 两处都必须过 normalizeDeps。
  for (const r of list) r.depends_on = normalizeDeps(r.depends_on);
  return list;
}

/** 定位 index.yaml 内某需求条目块的行区间 [start, end)（1-based 起始行 = `  - id: R-x`） */
function reqBlockRange(lines, reqId) {
  // B-gm-000019：起点必须是**严格 2 空格**缩进的 `  - id: <需求id>`。
  //   旧实现用 `^\s*-`，`\s*` 允许任意缩进 ⇒ 条目内 6 空格的嵌套 `- id: R-x`
  //   （depends_on 的边条目、以及将来的任何同 id 子项）会被当成该需求的条目起点，
  //   于是写 A 的块会串进 B 的条目、B 反而读成「没有这个块」。
  //   块尾那侧早已是严格 2 空格（注释写着「不能是 patches 数组项」），起点这侧对齐它。
  //   嵌套项 id 过去只有 `P-*`，永远不等于某个需求 id，所以这个口子一直没被触发。
  const head = new RegExp(`^ {2}-\\s*id:\\s*${escapeRe(reqId)}\\s*$`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (head.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  // 下一需求条目 = 严格 2 空格缩进 `  - id: ...`（不能是 patches 数组项 `- id: P-...`——后者缩进 ≥ 8）
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}-\s*id:\s*/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** 正则元字符转义（id 里只有 `-` 安全，但定位函数不该靠「调用方恰好传了安全串」） */
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 需求索引字段的行级改写（只动目标条目内该字段行，保留注释与其余字段）。
 * @returns {boolean} 是否命中并改写
 */
export function updateReqIndexField(projDir, reqId, field, value) {
  const p = reqIndexPath(projDir);
  if (!existsSync(p)) return false;
  const content = readFileSync(p, "utf8");
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const range = reqBlockRange(lines, reqId);
  if (!range) return false;
  const re = new RegExp(`^(\\s+)${field}:([^\\r\\n]*)$`);
  for (let i = range.start + 1; i < range.end; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    // 保留原行尾注释（`status: x   # 派生态` ⇒ 改写值不动注释）
    const rest = m[2] ?? "";
    const ci = rest.search(/\s#/);
    const comment = ci >= 0 ? rest.slice(ci) : "";
    const next = `${m[1]}${field}: ${value}${comment}`;
    if (next === lines[i]) return false; // 无变化
    lines[i] = next;
    writeFileSync(p, lines.join(eol), "utf8");
    return true;
  }
  return false;
}

/**
 * 读取需求条目内的子块原文（`    <key>:` 起的缩进块），去 4 空格基准缩进；无此块返回 null。
 * 用途：`versions:` 版本账并入 index.yaml 后的读侧入口（`lib/versions.mjs`）。
 */
export function readReqIndexBlock(projDir, reqId, key) {
  const p = reqIndexPath(projDir);
  if (!existsSync(p)) return null;
  const lines = readFileSync(p, "utf8").split(/\r?\n/);
  const range = reqBlockRange(lines, reqId);
  if (!range) return null;
  const body = blockExtent(lines, range, key);
  if (!body) return null;
  // 首行 = `    <key>:` 块头，取其后的值体并去掉 6 空格基准缩进（子行 = 块头 + 2）
  return body.lines
    .slice(1)
    .map((l) => (l.startsWith("      ") ? l.slice(6) : l.trimStart()))
    .join("\n");
}

/** 定位条目内子块（`    <key>:` → 块末）；无此块返回 null */
function blockExtent(lines, range, key) {
  const head = new RegExp(`^ {4}${key}:[^\\r\\n]*$`);
  let start = -1;
  for (let i = range.start + 1; i < range.end; i++) {
    if (head.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = range.end;
  for (let i = start + 1; i < range.end; i++) {
    const t = lines[i].trim();
    if (t === "") continue;
    if (lines[i].match(/^ */)[0].length <= 4) {
      end = i;
      break;
    }
  }
  return { start, end, lines: lines.slice(start, end) };
}

/**
 * 删除需求条目内的子块（文本级：只删该块的行，其余逐字保留）。
 * 用途：清单被删空时**不该留一个空键**（`context:` 后面什么都没有，读侧会当成「有个空块」）。
 * @returns {boolean} 是否改动（块不存在 ⇒ false）
 */
export function removeReqIndexBlock(projDir, reqId, key) {
  const p = reqIndexPath(projDir);
  if (!existsSync(p)) return false;
  const content = readFileSync(p, "utf8");
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const range = reqBlockRange(lines, reqId);
  if (!range) return false;
  const found = blockExtent(lines, range, key);
  if (!found) return false;
  // 只删**块自己的行**：`blockExtent` 的块尾会跨过空行去找边界，于是块后那条「条目分隔空行」
  //   也会落进 [start, end)。不摘掉它，删块后条目与下一条需求会贴在一起（YAML 仍合法，但文件风格退化，
  //   而且「删掉一个块」就不再是「回到加块之前的字节」——这种不可逆的轻微变形最难查）。
  let stop = found.end;
  while (stop > found.start + 1 && lines[stop - 1].trim() === "") stop--;
  const next = [...lines.slice(0, found.start), ...lines.slice(stop)];
  writeFileSync(p, next.join(eol), "utf8");
  return true;
}

/**
 * 写入/替换需求条目内的子块（blockText 为 0 基准缩进文本，写入时统一 +4）；块不存在则追加到条目末尾。
 * @returns {boolean} 是否改动
 */
export function upsertReqIndexBlock(projDir, reqId, key, blockText) {
  const p = reqIndexPath(projDir);
  if (!existsSync(p)) return false;
  const content = readFileSync(p, "utf8");
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const range = reqBlockRange(lines, reqId);
  if (!range) return false;
  const body = String(blockText ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+$/, "");
  const newLines = [`    ${key}:`, ...(body === "" ? [] : body.split("\n").map((l) => (l === "" ? "" : `      ${l}`)))];
  const found = blockExtent(lines, range, key);
  // 比较时**去掉尾部空行**：blockExtent 会把块后的空行也算进来（它跳过空行继续找边界），
  //   不归一就会把「内容一样、只是尾巴多一个空行」误判成「有改动」⇒ 幂等守卫 C14 就红了。
  const before = found ? lines.slice(found.start, found.end).join("\n").replace(/\s+$/, "") : "";
  if (before === newLines.join("\n")) return false;
  // 追加位：跳过条目尾部的空行（否则新块会和上一条目隔一个空行，条目内部出现空洞）
  let insertAt = range.end;
  while (insertAt > range.start + 1 && lines[insertAt - 1].trim() === "") insertAt--;
  const next = found
    ? [...lines.slice(0, found.start), ...newLines, ...lines.slice(found.end)]
    : [...lines.slice(0, insertAt), ...newLines, ...lines.slice(insertAt)];
  writeFileSync(p, next.join(eol), "utf8");
  return true;
}

/**
 * 需求验收 ⇒ **自动结子版**（0.28.2 R-gm-090 · 口径 Q2-A）：
 *   需求与子版 1:1，所以「需求 done」与「子版结版」是同一件事，不再写两次账。
 *
 * 只对**两个条件同时成立**的需求生效（否则不碰结版账）：
 *   ① **板上下文**：账根有 `board.yaml`——项目账没有这张牌，不会凭空长出 `subvers.yaml`；
 *   ② **新形态需求**：id 自带版本坐标（`R-gm-30-0` ⇒ 子版 `0.30.0`）；
 *      存量 `R-gm-088` 没有坐标，验收时**不追改历史**（已宣告的旧子版不许被重写）。
 *
 * 幂等：已有同号结版记录就原样不动（**不改日期**；改日期只能走 `gd ver reopen` + 重新结版）。
 * 尽力而为：子版账读写失败不阻断状态刷新（需求态已落盘），只把失败体现在返回值的 `error` 上。
 *
 * @param {string} projDir 账根（板根）
 * @param {string[]} reqIds 本次刚转成 done 的需求 id
 * @param {{on?: string|null}} [o] `on` = 结版日（缺省取今天）
 * @returns {{auto: {reqId: string, subver: string, at: string}[], skipped: {reqId: string, why: string}[], error: string|null}}
 */
export function autoReachSubversOf(projDir, reqIds, { on = null } = {}) {
  const outNothing = { auto: [], skipped: [], error: null };
  const ids = (Array.isArray(reqIds) ? reqIds : []).map((x) => String(x ?? "")).filter(Boolean);
  if (ids.length === 0) return outNothing;
  // ① 板上下文：项目账不结子版
  if (!existsSync(join(String(projDir), BOARD_FILE))) {
    return { auto: [], skipped: ids.map((reqId) => ({ reqId, why: "非板账（无 board.yaml）" })), error: null };
  }
  const plan = [];
  const skipped = [];
  for (const reqId of ids) {
    if (!isReqIdV2(reqId)) {
      skipped.push({ reqId, why: "存量形态无版本坐标（不追改历史）" });
      continue;
    }
    const alias = subverAliasOf(reqId);
    if (!alias) {
      skipped.push({ reqId, why: "缺陷 id 不带版本坐标（版本归属看 index 的 subver）" });
      continue;
    }
    plan.push({ reqId, subver: alias });
  }
  if (plan.length === 0) return { auto: [], skipped, error: null };
  const at = String(on ?? "").trim() || dateStrOfLocal();
  try {
    const auto = withBoardLock(projDir, () => {
      const cur = readSubvers(projDir);
      if (!cur.ok) throw new Error(cur.error || "子版账读取失败");
      const list = [...cur.list];
      const done = [];
      for (const p of plan) {
        const hit = list.find((s) => s.alias === p.subver);
        if (hit) {
          skipped.push({ reqId: p.reqId, why: `子版 ${p.subver} 已结版于 ${hit.reached_on}（幂等，不改日期）` });
          continue;
        }
        list.push({ alias: p.subver, reached_on: at, note: `需求 ${p.reqId} 验收自动结版` });
        done.push({ reqId: p.reqId, subver: p.subver, at });
      }
      if (done.length > 0) writeSubvers(projDir, list);
      return done;
    });
    return { auto, skipped, error: null };
  } catch (e) {
    // 尽力而为：结版账写不成不影响需求态已经落盘的事实，把错误交给调用方回显
    return { auto: [], skipped, error: e?.message ?? String(e) };
  }
}

/** 本地日期串 `YYYY-MM-DD`（结版日缺省值；与里程碑账同一口径） */
function dateStrOfLocal(now = Date.now()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 刷新需求派生态（index.yaml 的 status / task_count / task_done）——派生逻辑唯一出口。
 * 需求态 = 任务态派生（`deriveReqStatus`），不再由命令各自双写。
 *
 * 0.28.2 R-gm-090：需求转入 `done` 时，同一把锁内顺手把对应子版结掉（`autoReachSubversOf`）。
 * 变更项上多带一个 `auto_subver` 字段（有则字串、无则无此键）供调用方回显，**其它字段与返回形态不变**。
 * 需求从 `done` 回退时则带 `stale_subver`：子版仍标已结版但需求在途——**不自动撤**，只提示。
 * @returns {{reqId: string, from: string, to: string, auto_subver?: string, auto_error?: string, stale_subver?: string}[]} 实际变更项
 */
export function refreshReqStatuses(projDir, { reqIds, on = null } = {}) {
  const changed = [];
  const entries = new Map(readReqEntries(projDir).map((r) => [r.id, r]));
  const justRegressed = [];
  // 不变量（不是跃迁）：刷新后只要需求是 done，它的子版就必须已结版。
  //   为什么不用「跃迁」触发：`gd ver reopen` 之后需求仍是 done，状态不会翻回去，
  //   靠跃迁就永远不再触发——需求 done / 子版未结 的不一致会永久留着。
  //   靠不变量：每次刷新都幂等试一次（已结版就跳过，不改日期）；
  //   要让子版**真的**不结，就先把需求退回在途，或者接受下次写账时被复原。
  const nowDone = [];
  for (const reqId of reqIds ?? listReqIds(projDir)) {
    const ledger = readTaskLedger(projDir, reqId);
    if (ledger.missing) continue;
    const entry = entries.get(reqId);
    const before = String(entry?.status ?? "");
    const after = reqStatusOfLedger(ledger);
    const done = ledger.tasks.filter((t) => t.status === "done").length;
    if (before !== after) updateReqIndexField(projDir, reqId, "status", after);
    updateReqIndexField(projDir, reqId, "task_count", ledger.tasks.length);
    updateReqIndexField(projDir, reqId, "task_done", done);
    if (before !== after) {
      const item = { reqId, from: before, to: after };
      if (before === "done" && after !== "done") justRegressed.push(item);
      changed.push(item);
    }
    if (after === "done") nowDone.push(reqId);
  }
  if (nowDone.length > 0) {
    const r = autoReachSubversOf(projDir, nowDone, { on });
    for (const item of changed) {
      if (!nowDone.includes(item.reqId)) continue;
      if (item.to !== "done") continue;
      const hit = r.auto.find((a) => a.reqId === item.reqId);
      if (hit) item.auto_subver = hit.subver;
      else if (r.error) item.auto_error = r.error;
    }
    if (r.error) {
      for (const item of changed) if (item.to === "done") item.auto_error = r.error;
    }
  }
  if (justRegressed.length > 0) {
    for (const item of justRegressed) {
      const alias = isReqIdV2(item.reqId) ? subverAliasOf(item.reqId) : "";
      if (!alias) continue;
      // 只查**板上下文**的结版账；读不出来就当没有（不阻断需求态回退）
      try {
        if (!existsSync(join(String(projDir), BOARD_FILE))) continue;
        const cur = readSubvers(projDir);
        if (!cur.ok) continue;
        if (cur.list.some((s) => s.alias === alias)) item.stale_subver = alias;
      } catch {
        /* 读不出来就不提示，不阻断 */
      }
    }
  }
  return changed;
}

// ── 看板快照（操作台 / CLI `gd board` 共用） ────────────────

/**
 * 看板快照：需求 + 任务（4 态）+ 事件（可按需求限定）。
 * @param {string} projDir
 * @param {{eventLimit?: number}} [opts]
 */
export function boardSnapshot(projDir, { eventLimit = 0 } = {}) {
  const entries = new Map(readReqEntries(projDir).map((r) => [r.id, r]));
  const reqs = listReqIds(projDir).map((reqId) => {
    const ledger = readTaskLedger(projDir, reqId);
    return {
      id: reqId,
      title: String(entries.get(reqId)?.title ?? ""),
      statusStored: String(entries.get(reqId)?.status ?? ""),
      status: reqStatusOfLedger(ledger),
      // 0.47 R-gm-104：需求级依赖边（跨需求）。readReqEntries 已归一 ⇒ 这里只做投影，不再解析一次。
      depends_on: entries.get(reqId)?.depends_on ?? [],
      schemaVersion: ledger.schemaVersion,
      revision: ledger.revision,
      tasks: ledger.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        executor: t.executor,
        status: t.status,
        artifacts: t.artifacts ?? [],
        review: t.review ?? null,
        // 任务级依赖边（同需求）；normalizeTask 已归一
        depends_on: t.depends_on ?? [],
      })),
    };
  });
  const events = readAllEvents(projDir);
  return { reqs, events: eventLimit > 0 ? events.slice(-eventLimit) : events };
}


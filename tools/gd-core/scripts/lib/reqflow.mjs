/**
 * reqflow 数据层 — 需求-任务工作流读写与编号工具（**读侧门面**）
 * 规范见 entry/workflow/reqflow.md（§3 编号规则 / §4 状态机 / §5 文件规范）
 *
 * 轻协议重构后：账读写与状态派生的**单一实现**在 `lib/board.mjs`（两账 + 4 态）；本模块保留
 *   `gd task list/show` 等读面与旧调用点所需的门面（读任务账 → 归一 v4 任务形；状态派生转调 board）。
 *
 *   - 需求（需求级单一事实源）→ reqs/index.yaml 条目（title/summary/analysis/status/revision）
 *   - 任务 → task-list.yaml（唯一任务清单，v3）
 *   - 产出 + 交货单（deliverables/）落在 producer 仓库 <producer 仓库>/projects/<项目>/；共享区不再预建 deliver_*
 *   - structured/ 成品层属共享区（人工维护，机器流程不写入）
 *   - 交付定位经 subOutputRootOf（subLocal 由调用方经布局 subs.<agent>.local 解析）
 *
 * 职责：index.yaml / task-list.yaml 的读写、任务状态流转合法性、需求状态自动派生、交付检查。
 * 约定：项目目录（projDir）由调用方经 registry 解析传入，本模块不依赖 registry。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { parseYaml, unquoteScalar } from "./yaml.mjs";
import {
  deriveReqState as boardDeriveReqState,
  readTaskLedger as boardReadTaskLedger,
  refreshReqStatuses as boardRefreshReqStatuses,
  reqStatusOfLedger as boardReqStatusOfLedger,
} from "./board.mjs";
import { loadOrMigrateVersions, readReqRevision } from "./versions.mjs";
import { withBoardLock, readReqEntries } from "./board.mjs"; // 0.21.3：index 写面并发安全（锁内重读-改-写）；0.47：依赖反向边读需求条目
import { isReqDir } from "./reqid.mjs"; // 0.23.0 R-gm-061：需求目录形态（R- / B-）
import { normalizeDeps } from "./reqdep.mjs"; // 0.47 R-gm-104：依赖边（depends_on）读侧归一
// 编号口径单一事实源在 lib/reqid.mjs（0.23.0 R-gm-061）；本模块只做门面转出
export { reqSeqOf, taskIdOf } from "./reqid.mjs";

// ── 状态机（一套 4 态；条目见 entry/workflow/reqflow.md §4） ──────────────
// 唯一实现 = lib/board.mjs（状态枚举 / 流转表 / 需求态派生）；本模块只做门面转出。
export { TASK_TRANSITIONS, TASK_STATES } from "./board.mjs";

// 需求态由任务态派生（唯一实现 = lib/board.mjs deriveReqStatus）：无任务或全 ready → ready；全 done → done；任一 in_progress/review → in_progress。
// 即需求态只有 ready / in_progress / done 三态（任务态 4 态）；「未派 / 已派」由任务 executor 空否表达。
//   撤销：gd req delete（需求 done 之前可撤；done 终态拒绝）
export const REQ_TERMINAL = ["done"];
/** 需求是否可撤销（仅非终态） */
export function canReqDelete(reqStatus) {
  return !REQ_TERMINAL.includes(reqStatus);
}

/**
 * 需求状态派生（转调单一实现 `lib/taskstates.mjs: deriveReqState`）。
 *
 * 0.46.2 起判据多一维：**建了验收任务的需求，验收任务签过字才算 done**（甲-lite）。
 * 所以入参从「任务态数组」变成「任务对象数组」—— 状态与 kind 都得看得到；
 * 传字符串数组会在**唯一实现里**直接抛错（宁可当场炸，也不要静默按旧规则给出 done）。
 *
 * @param {object[]} tasks 任务对象数组（原样传账里的 tasks）
 */
export function deriveReqState(tasks) {
  return boardDeriveReqState(tasks);
}

// ── 路径（项目目录为根  需求为核心节点） ───────────────────
export function projectReqsDir(projDir) {
  return join(projDir, "reqs");
}
export function reqDirOf(projDir, reqId) {
  return join(projectReqsDir(projDir), reqId);
}
export function indexYamlPathOf(projDir) {
  return join(projectReqsDir(projDir), "index.yaml");
}
export function taskListYamlPathOf(projDir, reqId) {
  return join(reqDirOf(projDir, reqId), "task-list.yaml");
}
// ── 交付路径（产出 + 交货单归 producer 仓库；structured/ 为人工维护成品层） ──
/** producer 产出根：<producer 仓库>/projects/<项目名>/；subLocal 缺失时回退共享区项目根（兼容旧数据） */
export function subOutputRootOf(projDir, subLocal) {
  return subLocal ? join(subLocal, "projects", basename(projDir)) : projDir;
}
/** 交货单目录：<producer 产出根>/deliverables/（producer 仓库内，随产出归属 producer） */
export function deliverablesDirOf(projDir, subLocal) {
  return join(subOutputRootOf(projDir, subLocal), "deliverables");
}

// ── 跨项目任务遍历（单一实现：task list / 插槽孤儿守卫共用） ────────

/** 任务终态（done = 验收通过，review.pass 即终态） */
export const TASK_TERMINAL = ["done"];

/** 是否终态 */
export function isTaskTerminal(status) {
  return TASK_TERMINAL.includes(status);
}

/**
 * 遍历**一本账根**（项目库根 / 板根，两者目录形态同构：`<根>/reqs/<R-id>/task-list.yaml`）的需求×任务元组。
 * 0.24.1 R-gm-076：板仓读面（task list / task show / board）要走同一条遍历，故把「单个根」抽成这一步，
 * 跨项目那层（`collectAllTasks`）只是它的循环——读口径仍只有一份实现。
 * @param root 账根（板根 = `board.root`；项目根 = `<项目库>/<项目名>`）
 * @returns {{ task, reqId, projectId, projectName, projDir }[]}
 */
export function collectTasksFromRoot(root, { reqId = null, projectId = null, projectName = null } = {}) {
  const out = [];
  const reqsDir = join(root, "reqs");
  if (!existsSync(reqsDir)) return out;
  for (const d of readdirSync(reqsDir)) {
    if (!isReqDir(d)) continue;
    if (reqId && d !== reqId) continue;
    if (!existsSync(taskListYamlPathOf(root, d))) continue;
    for (const t of listTasks(root, d)) {
      out.push({ task: t, reqId: d, projectId, projectName, projDir: root });
    }
  }
  return out;
}

/**
 * 遍历所有已登记项目的需求×任务元组（不经状态/producer 过滤），按项目注册顺序 + 需求目录顺序排列。
 * 从 `task-list.mjs` 提回共享层——`gd agent remove` 的**孤儿任务守卫**需要同一遍历口径
 *（黑盒单实现；勿在别处再写一份）。
 * @param projectsDir 共享项目区目录（`findProjectsDir(mainLocal)`）
 * @returns {{ task, reqId, projectId, projectName, projDir }[]}
 */
export function collectAllTasks(projectsDir, reg, { projectId, reqId } = {}) {
  const out = [];
  for (const [pid, entry] of Object.entries(reg?.projects || {})) {
    if (projectId && pid !== projectId) continue;
    const projName = entry.name;
    out.push(...collectTasksFromRoot(join(projectsDir, projName), { reqId, projectId: pid, projectName: projName }));
  }
  return out;
}

/**
 * 插槽孤儿任务扫描（插拔守卫）：某执行方名下**非终态**任务
 * （非终态 = ready / in_progress / review；done = 已验收，结清）。
 */
export function scanAgentOpenTasks(projectsDir, reg, agentId) {
  return collectAllTasks(projectsDir, reg).filter((r) => r.task?.executor === agentId && !isTaskTerminal(r.task?.status));
}

// ── 读：需求（需求级单一事实源 = reqs/index.yaml 条目） ─────────
/**
 * 读需求：reqs/index.yaml 中的条目（id/title/summary/analysis/status/revision…）。
 * 「需求存在」即「索引有条目」——无条目 / index.yaml 不可解析返回 null。
 */
export function readReq(projDir, reqId) {
  const entry = (readIndex(projDir)?.requirements || []).find((r) => r?.id === reqId);
  if (!entry) return null;
  return {
    ...entry,
    title: unquoteScalar(String(entry.title ?? "")),
    // 归属（0.16.6）：**可选标量**——空 / 缺省归一到 null（写侧 setBlockOptionalScalar 删行，不写空标量行）
    assignee: optionalScalarText(entry.assignee) || null,
    revision: readReqRevision(entry), // 归一规则单一事实源（lib/versions.mjs）
  };
}

/**
 * 读需求 + 自动零迁移首写 versions.yaml（v）。
 * 需求条目不存在返回 null；存在但 versions.yaml 缺失时按 §11 零迁移写。
 * 返回 { req, versions, migrated }。
 */
export function loadReqWithVersions(projDir, reqId) {
  const req = readReq(projDir, reqId);
  if (!req) return null;
  const { data, migrated } = loadOrMigrateVersions(projDir, reqId, req);
  return { req, versions: data, migrated };
}

/** 读需求索引；不存在返回默认空结构，解析失败返回 null */
export function readIndex(projDir) {
  const p = indexYamlPathOf(projDir);
  if (!existsSync(p)) return { next_req_no: 1, requirements: [] };
  try {
    const doc = parseYaml(readFileSync(p, "utf8"));
    // 0.47 R-gm-104：需求条目的依赖边（跨需求）读侧归一（恒为数组，手写 `[R-x]` 归一成 `{id}`）。
    //   ⚠️ 与 `board.mjs: readReqEntries()` 是两个读点（反向 import 会成环）⇒ 两处都必须过 normalizeDeps。
    //   写回安全：writeIndexYaml 对未知子树 byte-identical 搬运 ⇒ 这里补的 `depends_on: []` 不会凭空落盘。
    for (const r of Array.isArray(doc?.requirements) ? doc.requirements : []) {
      if (r && typeof r === "object" && !Array.isArray(r)) r.depends_on = normalizeDeps(r.depends_on);
    }
    return doc;
  } catch {
    return null;
  }
}

// ── 读：任务账（v4 单一事实源；v3 账按旧状态映射归一） ─────────
/** 读任务账（门面：转调 lib/board.mjs）；账不存在返回 null */
export function readTaskList(projDir, reqId) {
  const ledger = boardReadTaskLedger(projDir, reqId);
  if (ledger.missing) return null;
  return { req: ledger.req, schema_version: ledger.schemaVersion, tasks: ledger.tasks };
}

/** 读单个任务（从 task-list 中按 id 找）；不存在返回 null */
export function readTask(projDir, reqId, taskId) {
  const tl = readTaskList(projDir, reqId);
  if (!tl) return null;
  return (Array.isArray(tl.tasks) ? tl.tasks : []).find((t) => t?.id === taskId) || null;
}

/** 列某需求的任务（按 task-list 顺序）；未拆分返回 [] */
export function listTasks(projDir, reqId) {
  const tl = readTaskList(projDir, reqId);
  if (!tl) return [];
  return Array.isArray(tl.tasks) ? tl.tasks : [];
}

/** 下一个任务序号（需求内 2 位）：按 task-list 已有任务 id 尾段最大序号 + 1 */
export function nextTaskNo(projDir, reqId) {
  const tasks = listTasks(projDir, reqId);
  const nos = tasks
    .map((t) => {
      const m = String(t?.id || "").match(/-(\d+)$/);
      return m ? Number(m[1]) : 0;
    })
    .filter((n) => n > 0);
  return (nos.length ? Math.max(...nos) : 0) + 1;
}

// ── 写 ─────────────────────────────────────────────────────

/**
 * 更新 task-list.yaml 中指定任务的某标量字段行（文本级：块内 <field>: 行替换，保持行序与注释）；返回是否成功。
 */
export function updateTaskField(projDir, reqId, taskId, field, value) {
  const p = taskListYamlPathOf(projDir, reqId);
  if (!existsSync(p)) return false;
  const content = readFileSync(p, "utf8");
  const eol = content.includes("\r\n") ? "\r\n" : "\n"; // 保留原行尾风格（同 agent-version.ts 行尾容错）
  const lines = content.split(/\r?\n/);
  let updated = false;
  const re = new RegExp(`^(\\s+)-\\s*id:\\s*(T-[\\w-]+\\d+)`);
  const fieldRe = new RegExp(`^(\\s+)${field}:`);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === null) continue;
    const m = line.match(re);
    if (m && m[2] === taskId) {
      // 找到该任务块：向下找第一个 <field>: 行，原地替换（保持行序）
      for (let j = i + 1; j < lines.length; j++) {
        const fm = lines[j].match(fieldRe);
        if (fm) {
          // 行尾容错：`[^\r\n]*$` 而非 `.*$`——CRLF 文件下（已按 \n 切行、尾留 \r）`.*$` 会整体失配、静默不改（同 补丁 manifest 版本回写缺陷）
          const indent = fm[1];
          const val = String(value ?? "").replace(/\r\n/g, "\n");
          const valLines = val.split("\n");
          const multi = valLines.length > 1 && val.trim() !== "";
          // 先把**旧值**的缩进块摘掉（它属于旧值，留着会变成新值的残留行）
          let k = j + 1;
          while (k < lines.length) {
            const l = lines[k];
            if (l.trim() === "") {
              // 空行归属看下一行：下一行仍属旧块 ⇒ 空行也属于旧块
              const nxt = lines[k + 1];
              const nxtInd = nxt ? (nxt.match(/^(\s*)/)?.[1] ?? "").length : -1;
              if (nxt && nxtInd > indent.length && !/^\s*-\s*id:/.test(nxt)) { k++; continue; }
              break;
            }
            const ind = (l.match(/^(\s*)/)?.[1] ?? "").length;
            if (ind > indent.length && !/^\s*-\s*id:/.test(l)) { k++; continue; }
            break;
          }
          if (multi) {
            // **多行 ⇒ 块标量（`|`）**（B-gm-000016）：直拼成一行会让续行顶格 ⇒ YAML 结构坏掉
            //   （实测：两条后续任务被解析吞掉，账只剩 1 条任务）。块标量与 review.note / 完整 CLI 同一形态。
            lines[j] = `${indent}${field}: |`;
            lines.splice(j + 1, k - (j + 1), ...valLines.map((l) => (l === "" ? "" : `${indent}  ${l}`)));
          } else {
            lines[j] = `${indent}${field}: ${valLines[0] ?? ""}`;
            lines.splice(j + 1, k - (j + 1));
          }
          updated = true;
          break;
        }
        if (/^\s+-\s*id:/.test(lines[j])) break; // 越出本任务块
      }
    }
    out.push(line);
  }
  if (!updated) return false;
  writeFileSync(p, out.join(eol), "utf8");
  return true;
}

/** 更新任务状态（委托 updateTaskField，保持旧签名兼容） */
export function updateTaskStatus(projDir, reqId, taskId, status) {
  return updateTaskField(projDir, reqId, taskId, "status", status);
}

/** 更新需求状态（唯一事实源 = index.yaml 条目）。返回是否成功 */
export function updateReqStatus(projDir, reqId, status) {
  return updateIndex(projDir, reqId, { status });
}

/** 更新 index.yaml 某需求条目（status/revision/summary/analysis/task_count/task_done 等）；未找到返回 false */
export function updateIndex(projDir, reqId, patch) {
  // 并发安全（0.21.3）：**锁内重读-改-写**。index.yaml 是所有需求共用的单文件，
  //   若在锁外先读、再进锁写，就会用旧快照覆盖掉别人刚写入的改动（静默丢更新）。
  return withBoardLock(projDir, () => {
    const idx = readIndex(projDir);
    if (!idx) return false;
    const reqs = Array.isArray(idx.requirements) ? idx.requirements : [];
    const i = reqs.findIndex((r) => r?.id === reqId);
    if (i < 0) return false;
    reqs[i] = { ...reqs[i], ...patch };
    writeIndexYaml(indexYamlPathOf(projDir), idx);
    return true;
  });
}

/** 从 index.yaml 注销某需求（删除用；next_req_no 不回退）；未找到返回 false */
export function removeReqFromIndex(projDir, reqId) {
  return withBoardLock(projDir, () => {
    const idx = readIndex(projDir);
    if (!idx) return false;
    const reqs = Array.isArray(idx.requirements) ? idx.requirements : [];
    const next = reqs.filter((r) => r?.id !== reqId);
    if (next.length === reqs.length) return false;
    idx.requirements = next;
    writeIndexYaml(indexYamlPathOf(projDir), idx);
    return true;
  });
}

/** 需求条目内**已知字段**（顺序即新条目块的字段序）；其余字段 = 未知子树，保字段写回时原样搬运 */
const REQ_KNOWN_SCALARS = ["status", "initiator", "created", "revision", "task_count", "task_done"];

/**
 * 缺陷口径的可选标量（0.21.14）：`kind` 缺省 feature **不落盘**（存量条目零 diff），
 *   `affects` 以逗号串落盘（行级序列化友好）。口径校验在 `lib/defects.mjs`。
 */
function DEFECT_SCALARS_OF(r) {
  const out = [];
  const kind = String(r.kind ?? "").trim();
  if (kind && kind !== "feature") out.push(["kind", kind]);
  const severity = String(r.severity ?? "").trim();
  if (severity) out.push(["severity", severity]);
  const foundIn = String(r.found_in ?? "").trim();
  if (foundIn) out.push(["found_in", foundIn]);
  const affects = Array.isArray(r.affects) ? r.affects.join(",") : String(r.affects ?? "").trim();
  if (affects) out.push(["affects", affects]);
  // 0.66：缺陷挂点（能力/判据/场景）——与上面四字段同族：有值才落盘，存量条目零 diff
  const capRef = String(r.capability_ref ?? "").trim();
  if (capRef) out.push(["capability_ref", capRef]);
  return out;
}

/** 已知字段的渲染值（与条目块既有格式一致：title / initiator 走 yamlScalar，revision 走 readReqRevision） */
function knownFieldText(r, key) {
  switch (key) {
    case "title":
      return yamlScalar(r.title);
    case "initiator":
      return yamlScalar(r.initiator ?? "用户");
    case "revision":
      return String(readReqRevision(r));
    case "task_count":
      return String(r.task_count ?? 0);
    case "task_done":
      return String(r.task_done ?? 0);
    default:
      return String(r[key] ?? "");
  }
}

/** 可选标量文本（0.16.6）：去引号 + trim；空 / 缺省 → ""（= 不写该字段） */
function optionalScalarText(v) {
  return v == null ? "" : unquoteScalar(String(v)).trim();
}

/** 字面块体（多行文本 → 0 缩进内容行；与 `pushYamlBlock` 同口径）；空文本返回 null */
function blockBodyOf(text) {
  const body = String(text ?? "").replace(/\r\n/g, "\n").replace(/\s+$/, "");
  if (body.trim() === "") return null;
  return body.split("\n");
}

/**
 * 定位条目内某 4 缩进字段的行区间（`    <key>:` 起，含其字面块体；空行算块内，遇缩进 ≤ 4 的非空行收尾）。
 * @returns {{start: number, core: number, end: number}|null} start = 字段头行；core = 块体末（不含尾部空行）；
 *   end = 含尾部空行的边界 —— 改写只在 [start, core) 内替换，尾部空行原样留存（零无谓 diff）
 */
function fieldExtent(lines, key, from, to) {
  const head = new RegExp(`^ {4}${key}:[^\r\n]*$`);
  let start = -1;
  for (let i = from; i < to; i++) {
    if (head.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = start + 1;
  for (let i = start + 1; i < to; i++) {
    if (lines[i].trim() === "") {
      end = i + 1;
      continue;
    }
    if (lines[i].match(/^ */)[0].length <= 4) break; // 回到条目级字段 ⇒ 本字段块体结束
    end = i + 1;
  }
  let core = end;
  while (core > start + 1 && lines[core - 1].trim() === "") core--;
  return { start, core, end };
}

/**
 * 条目块内原位改单行标量字段：已同值则零 diff；字段缺失则补写（title 紧随 `- id:`，其余追加到条目块末）。
 * @param {string[]} block 条目块行（可变数组）
 */
function setBlockScalar(block, key, text) {
  const ext = fieldExtent(block, key, 0, block.length);
  const line = `    ${key}: ${text}`;
  if (ext) {
    if (ext.core === ext.start + 1 && block[ext.start] === line) return;
    block.splice(ext.start, ext.core - ext.start, line);
    return;
  }
  const idAt = block.findIndex((l) => /^ {2}- id:/.test(l));
  if (key === "title") block.splice(idAt < 0 ? 0 : idAt + 1, 0, line);
  else block.push(line);
}

/**
 * 条目块内**可选标量**（0.16.6：`assignee` 归属）——与 REQ_KNOWN_SCALARS（恒存在字段）分开：
 *   有值 ⇒ 原位设置（缺则插在 `after` 字段之后，缺省紧随 `- id:`）；空值 ⇒ 删除既有行（无则零 diff）。
 * 为什么要分开：恒存在字段缺省会写成空标量行（如 `assignee: `），给**所有存量需求**添无谓 diff——
 *   归属是「可缺省」的语义（未指派 = 没这个字段）。
 */
function setBlockOptionalScalar(block, key, value, { after = null } = {}) {
  const v = optionalScalarText(value);
  const ext = fieldExtent(block, key, 0, block.length);
  if (v === "") {
    if (ext) block.splice(ext.start, ext.core - ext.start);
    return;
  }
  const line = `    ${key}: ${yamlScalar(v)}`;
  if (ext) {
    if (ext.core === ext.start + 1 && block[ext.start] === line) return;
    block.splice(ext.start, ext.core - ext.start, line);
    return;
  }
  const anchor = after ? block.findIndex((l) => new RegExp(`^ {4}${after}:[^\\r\\n]*$`).test(l)) : -1;
  const idAt = block.findIndex((l) => /^ {2}- id:/.test(l));
  // 插点优先级：紧跟 `after` 字段 > 紧随 `- id:` > 追加到块尾
  let at = block.length;
  if (anchor >= 0) at = anchor + 1;
  else if (idAt >= 0) at = idAt + 1;
  block.splice(at, 0, line);
}

/** 条目块内原位改字面块字段（summary / analysis）；新值为空 ⇒ 删除该块；已同值 ⇒ 零 diff */
function setBlockText(block, key, text) {
  const ext = fieldExtent(block, key, 0, block.length);
  const body = blockBodyOf(text);
  const next = body ? [`    ${key}: |`, ...body.map((l) => (l === "" ? "" : `      ${l}`))] : null;
  if (!next) {
    if (ext) block.splice(ext.start, ext.core - ext.start);
    return;
  }
  if (ext && block.slice(ext.start, ext.core).join("\n") === next.join("\n")) return;
  if (ext) block.splice(ext.start, ext.core - ext.start, ...next);
  else block.push(...next);
}

/**
 * 条目块内原位改**列表字段**（`needs`；m-7 0.70.0）。
 *
 * 与 `setBlockText` 同一套块边界口径（`fieldExtent`：块体 = 之后第一个「非空且缩进 ≤ 4」的行）。
 * **新值为空 ⇒ 删掉整个字段**——「没声明」与「声明了空」语义相同，落两种形态只会让读侧多一次归一。
 * 插入位置：规范字段序里 `needs` 在 `summary` 之前（与 `renderReqBlockFresh` 同序）。
 */
function setBlockList(block, key, arr) {
  const list = (Array.isArray(arr) ? arr : []).map((x) => String(x ?? "").trim()).filter(Boolean);
  const ext = fieldExtent(block, key, 0, block.length);
  const next = list.length === 0 ? null : [`    ${key}:`, ...list.map((v) => `      - ${yamlScalar(v)}`)];
  if (!next) {
    if (ext) block.splice(ext.start, ext.core - ext.start);
    return;
  }
  if (ext) {
    if (block.slice(ext.start, ext.core).join("\n") === next.join("\n")) return;
    block.splice(ext.start, ext.core - ext.start, ...next);
    return;
  }
  const before = block.findIndex((l) => /^ {4}summary:[^\r\n]*$/.test(l));
  block.splice(before >= 0 ? before : block.length, 0, ...next);
}

/** 原文 → 需求条目块索引（Map<reqId, {start, end}>；严格 2 空格 `  - id:`，不误吞补丁账的 8 缩进 `- id: P-…`） */
function splitReqBlocks(lines) {
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {2}- id:\s*(\S+)\s*$/.exec(lines[i]);
    if (m) heads.push({ i, id: m[1] });
  }
  const map = new Map();
  for (let k = 0; k < heads.length; k++) {
    const start = heads[k].i;
    let end = k + 1 < heads.length ? heads[k + 1].i : lines.length;
    while (end > start && lines[end - 1].trim() === "") end--;
    map.set(heads[k].id, { start, end });
  }
  return map;
}

/** 新条目块（原文查无此需求）：按规范字段序整块渲染 */
function renderReqBlockFresh(r) {
  const lines = [`  - id: ${r.id}`, `    title: ${yamlScalar(r.title)}`];
  const assignee = optionalScalarText(r.assignee);
  if (assignee) lines.push(`    assignee: ${yamlScalar(assignee)}`); // 0.16.6 归属（可选标量：无值不写）
  if (optionalScalarText(r.subver)) lines.push(`    subver: ${yamlScalar(r.subver)}`); // 子版号 x.y.z（0.21.x：与需求 1:1）
  for (const [key, val] of DEFECT_SCALARS_OF(r)) lines.push(`    ${key}: ${yamlScalar(val)}`); // 0.21.14：缺陷口径（空值不落盘）
  for (const key of REQ_KNOWN_SCALARS) lines.push(`    ${key}: ${knownFieldText(r, key)}`);
  pushYamlList(lines, "needs", r.needs); // m-7 0.70.0：需求能力诉求（裸专业能力 id 数组；未声明不落盘）
  pushYamlBlock(lines, "summary", r.summary);
  pushYamlBlock(lines, "analysis", r.analysis);
  return lines;
}

/** 存量条目块（原文已有此需求）：已知字段原位改写，未知子树（versions / patches / registry_changes …）逐字保留 */
function renderReqBlockExisting(blockLines, r) {
  const block = blockLines.slice();
  setBlockScalar(block, "title", knownFieldText(r, "title"));
  setBlockOptionalScalar(block, "assignee", r.assignee, { after: "title" }); // 0.16.6 归属（空值≡无此字段）
  setBlockOptionalScalar(block, "subver", optionalScalarText(r.subver), { after: "status" }); // 子版号（可选标量）
  // 0.21.14：缺陷口径四字段（kind 缺省 feature ⇒ 不落盘，存量条目零 diff）
  for (const [key, val] of DEFECT_SCALARS_OF(r)) setBlockOptionalScalar(block, key, val, { after: key === "kind" ? "subver" : key });
  for (const key of ["kind", "severity", "found_in", "affects", "capability_ref"]) if (!DEFECT_SCALARS_OF(r).some(([k]) => k === key)) setBlockOptionalScalar(block, key, "", { after: "subver" });
  for (const key of REQ_KNOWN_SCALARS) setBlockScalar(block, key, knownFieldText(r, key));
  setBlockList(block, "needs", r.needs); // m-7 0.70.0：需求能力诉求（列表字段；空 ⇒ 删掉该字段）
  setBlockText(block, "summary", r.summary);
  setBlockText(block, "analysis", r.analysis);
  return block;
}

/**
 * 序列化并写回 index.yaml —— **保字段写回**（保留规范注释；多行 summary / analysis 用字面块 `|`）。
 *
 * 关键约束：条目内除已知字段外还有**未知子树**（`versions:` 版本链 / `patches` 补丁账 / `registry_changes` …，
 *   见 entry/workflow/reqflow.md §5.1）。白名单整文件重排会把这些静默删掉（现网事故：green-tide `54255e8`
 *   「需求登记 R-gt-005」连带删 2 段 versions / 234 行）。本实现口径：
 *   **原文块内行级改写已知字段，未知子树整块 byte-identical 搬运**；仅当原文查无此需求时才整块新渲染。
 */
export function writeIndexYaml(idxPath, idx) {
  const reqs = Array.isArray(idx.requirements) ? idx.requirements : [];
  const prevText = existsSync(idxPath) ? readFileSync(idxPath, "utf8") : "";
  const eol = prevText.includes("\r\n") ? "\r\n" : "\n";
  const prevLines = prevText ? prevText.split(/\r?\n/) : [];
  const blocks = splitReqBlocks(prevLines);

  // 头部：原文 `requirements:` 之前的行逐字保留（含注释），只改写 next_req_no 行；无原文则用规范两行注释
  const reqAt = prevLines.findIndex((l) => /^requirements:\s*$/.test(l));
  const head =
    reqAt >= 0
      ? prevLines.slice(0, reqAt)
      : [
          "# 需求索引 — 本项目需求单一事实源（总控维护）",
          "# 需求级信息（title / summary / analysis / status / revision）一律在此；reqs/<id>/ 下只有 task-list.yaml",
        ];
  const nextNo = `next_req_no: ${idx.next_req_no ?? 1}`;
  const ni = head.findIndex((l) => /^next_req_no:/.test(l));
  if (ni >= 0) head[ni] = nextNo;
  else head.push(nextNo);
  // 0.23.0 R-gm-061：缺陷独立计数器（沿用旧头部的行位；首板落在 next_req_no 之后）
  if (idx.next_bug_no !== undefined && idx.next_bug_no !== null) {
    const bugNo = `next_bug_no: ${idx.next_bug_no}`;
    const bi = head.findIndex((l) => /^next_bug_no:/.test(l));
    if (bi >= 0) head[bi] = bugNo;
    else {
      const anchor = head.findIndex((l) => /^next_req_no:/.test(l));
      head.splice(anchor >= 0 ? anchor + 1 : head.length, 0, bugNo);
    }
  }

  const out = [...head, "requirements:"];
  for (const r of reqs) {
    const hit = blocks.get(String(r.id));
    out.push(...(hit ? renderReqBlockExisting(prevLines.slice(hit.start, hit.end), r) : renderReqBlockFresh(r)));
  }
  out.push("");
  writeFileSync(idxPath, out.join(eol), "utf8");
}

/** 单行标量：含注释符 / 行首引号时加双引号（读侧 unquoteScalar 归一） */
function yamlScalar(v) {
  const s = String(v ?? "");
  return /\s#|^["']/.test(s) ? `"${s.replace(/"/g, "'")}"` : s;
}

/** 多行文本 → 字面块行（条目内缩进 4）；空值不写该键 */
function pushYamlBlock(lines, key, text) {
  const body = String(text ?? "").replace(/\r\n/g, "\n").replace(/\s+$/, "");
  if (body.trim() === "") return;
  lines.push(`    ${key}: |`);
  for (const l of body.split("\n")) lines.push(l === "" ? "" : `      ${l}`);
}

/**
 * 字符串列表 → 列表行（条目内缩进 4）；空数组不写该键。
 *
 * 用于 `needs`（需求能力诉求 · m-7 0.70.0）。**不写空数组**是刻意的：`needs: []` 与「没有这个键」
 * 在语义上都是「未声明」，落盘两份形态会让读侧多一次归一（判空必须在解引号之后 —— 0.47 的口径）。
 */
function pushYamlList(lines, key, arr) {
  const list = (Array.isArray(arr) ? arr : []).map((x) => String(x ?? "").trim()).filter(Boolean);
  if (list.length === 0) return;
  lines.push(`    ${key}:`);
  for (const v of list) lines.push(`      - ${yamlScalar(v)}`);
}

/**
 * 任务流转后同步需求派生状态（index.yaml 条目：status / task_count / task_done）。 * 需求已至终态（verified）不覆盖；tasks 摘要/统计随 task-list 实际状态刷新。
 * @returns {string|null} 派生后的需求状态；需求不存在返回 null
 */
/**
 * 删任务块（**文本级**：保留其余任务的 status/input/注释原样；0.16.8 抽到 reqflow 共用）——
 * `gd task delete`（需求级结构面保留给 owner）与 `gd seat task delete`（席位侧任务面）走同一实现。
 *
 * ⚠️ **块边界按缩进认**（B-gm-000018）：不能按「任何缩进的 `- id:`」判——`traces` 与 `depends_on`
 *   的条目本身就是 6 空格缩进的 `- id:`，那样任务块会在**第一个嵌套项**处被截断，
 *   残留的 `- id: <trace>` / `at:` / `by:` 行重解析后变成一条**幽灵任务**（实测踩到）。
 *   规则：块尾 = 之后第一个「非空 且 缩进 ≤ 任务条目自身缩进」的行。
 *
 * @param {string} yamlText task-list.yaml 全文
 * @param {string} taskId 任务 id
 * @returns {string|null} 删后的全文；找不到该块 = null
 */
export function deleteTaskBlock(yamlText, taskId) {
  const lines = yamlText.split("\n");
  let startIdx = -1;
  let taskIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s+)-\s*id:\s*(T-[\w-]+\d+)/);
    if (m && m[2] === taskId) {
      startIdx = i;
      taskIndent = m[1].length;
      break;
    }
  }
  if (startIdx < 0) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    // 空行留在块内：多行 `input: |` 的字面块中间就有空行，当边界会把它腰斩
    if (line.trim() === "") continue;
    const ind = line.match(/^ */)[0].length;
    if (ind <= taskIndent) {
      endIdx = i;
      break;
    }
  }
  const out = [...lines.slice(0, startIdx), ...lines.slice(endIdx)].join("\n");
  // 原文以换行结尾 ⇒ 删后也以换行结尾：删「最后一个任务」时块尾就是文件尾，不补的话
  //   会把文件尾换行一起带走，git 里每次多一条 `\ No newline at end of file`（normalizeEmptyTasks 也做同样兜底）。
  return yamlText.endsWith("\n") && !out.endsWith("\n") ? `${out}\n` : out;
}

/**
 * 删后空列表兜底：tasks 段已无任务条目时折叠为 `tasks: []`（gen/add 可再识别续用）。
 *
 * ⚠️ 「还有没有任务」只认**任务 id 形态**（`- id: T-…`）：顶层 `work_units` 的条目正是
 *   `  - id: req/xxx`，按「任何 `- id:`」判会在「任务全删光、只剩工作单元」时误判成「还有任务」，
 *   `tasks:` 折不成 `tasks: []`（B-gm-000018 同族第二个洞）。
 */
// ══ 依赖边的**引用保护**（0.47 R-gm-104 · T-gm-104-06 · 设计稿 §5）═══════════
//
// 「删被引用的需求 / 任务」要**拒**并点名谁在引用：留一条指向空气的边，比不许删更麻烦——
//   删的人以为干净了，读到的人以为只是没开工。
// 两个函数都只回答「谁在引用它」，不决定怎么处置（拒 / 提示 / 落事件归调用方）。

/**
 * 哪些**需求**依赖了 `reqId`（反向边，现算不落账）。
 * @param {string} projDir 板根 / 项目根（两本账同一个读法）
 * @param {string} reqId
 * @returns {Array<{id: string, title: string}>} 引用者清单；空数组 = 没人依赖
 */
export function reqDependentsOf(projDir, reqId) {
  const target = String(reqId ?? "");
  return readReqEntries(projDir)
    .filter((e) => normalizeDeps(e.depends_on).some((d) => String(d.id) === target))
    .map((e) => ({ id: String(e.id ?? ""), title: String(e.title ?? "") }));
}

/**
 * 哪些**任务**（同需求内）依赖了 `taskId`。
 *
 * 入参是 task-list.yaml 的**全文**而不是路径：两个删除入口（`gd task delete` / `gd seat task delete`）
 *   都已经把全文读在手上了，再传路径等于让它们读第二遍（且可能读到不同的版本）。
 *
 * @param {string} yamlText task-list.yaml 全文
 * @param {string} taskId
 * @returns {Array<{id: string, title: string}>}
 */
export function taskDependentsIn(yamlText, taskId) {
  const target = String(taskId ?? "");
  const doc = parseYaml(yamlText) ?? {};
  const tasks = Array.isArray(doc.tasks) ? doc.tasks : [];
  return tasks
    .filter((t) => normalizeDeps(t?.depends_on).some((d) => String(d.id) === target))
    .map((t) => ({ id: String(t?.id ?? ""), title: String(t?.title ?? "") }));
}

export function normalizeEmptyTasks(text) {
  if (/^\s+- id:\s*T-/m.test(text)) return text;
  const lines = text.split("\n");
  const out = [];
  let inTasksTail = false;
  for (const l of lines) {
    if (/^tasks:\s*$/.test(l)) {
      inTasksTail = true;
      out.push("tasks: []");
      continue;
    }
    if (inTasksTail && l.trim() === "") continue; // 折叠 tasks 后的空尾行
    out.push(l);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  out.push("");
  return out.join("\n");
}

export function syncReqDerived(projDir, reqId) {  const req = readReq(projDir, reqId);
  if (!req) return null;
  if (REQ_TERMINAL.includes(req.status)) return req.status;
  // 派生单实现：board.refreshReqStatuses（status / task_count / task_done 一并刷新）
  boardRefreshReqStatuses(projDir, { reqIds: [reqId] });
  return boardReqStatusOfLedger(boardReadTaskLedger(projDir, reqId));
}

// ── 交付检查（路径更新；语义对齐 gd-manager data.ts readTaskInfo） ──

/** 件作用域（v3）：file = path 自身；package = root（缺省 = path 所在目录） */
export function deliverableScopeOf(entry) {
  const p = String(entry?.path ?? "");
  if (entry?.kind !== "package") return p;
  const root = entry?.root ? String(entry.root) : "";
  if (root) return root;
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

/**
 * 读交付登记（producer 写，每任务一文件：<producer 产出根>/deliverables/T-<id>.yaml；subLocal 为 null 回退共享区旧路径）
 * 额外回传 `file` / `entries`（逐条 path|kind|desc）/ `completed`，供 `gd task show` 做现状快照
 * entries 携 kind/root/manifest/verify + scope；`paths` = 各件的作用域（file = path；package = root）
 * **交货单只写当前约定**——不再有 retired 条目与过滤逻辑，`paths` / `activeCount` 即全部条目
 * structPath 字段恒为 null（struct_path 机制已废弃；保留字段仅为向后兼容）
 */
export function readDeliverables(projDir, reqId, taskId, subLocal = null) {
  const p = join(deliverablesDirOf(projDir, subLocal), `${taskId}.yaml`);
  const empty = { exists: false, paths: [], structPath: null, file: p, entries: [], activeCount: 0, completed: null };
  if (!existsSync(p)) return empty;
  try {
    const del = parseYaml(readFileSync(p, "utf8"));
    const raw = Array.isArray(del?.deliverables) ? del.deliverables : [];
    const entries = raw
      .filter((d) => d && typeof d === "object" && d.path)
      .map((d) => ({
        path: String(d.path),
        kind: d.kind ?? null,
        desc: d.desc ?? null,
        root: d.root ?? null,
        manifest: d.manifest ?? null,
        verify: d.verify ?? null,
        scope: deliverableScopeOf(d),
      }));
    return {
      exists: true,
      paths: entries.map((e) => e.scope || e.path),
      structPath: null, // ：机制废弃，保留字段仅为向后兼容（调用方不报 undefined）
      file: p,
      entries,
      activeCount: entries.length,
      completed: typeof del?.completed === "string" && del.completed ? del.completed : null,
    };
  } catch {
    return empty;
  }
}

/**
 * 单任务交付检查（交付登记唯一事实——任务不再落 output；v3：按件作用域 + 跳过 retired）：
 * ① 无交付登记文件 → 交付登记缺失；② 登记了但件作用域未落盘 → 登记文件缺失；③ 全在 → 逐条通过。
 * 交付物形态/路径由 producer 按能力规格自定（黑盒），总控只查「有没有交、文件在不在」，
 * 不查「交的是不是规定的那份」——内容/结构达标归 producer 能力规格自检 + 用户 verify 兜底。
 * @returns {{ delExists: boolean, checks: {desc:string,ok:boolean}[] }}
 */
export function checkTaskDelivery(projDir, reqId, task, subLocal = null) {
  const { exists: delExists, paths: scopes } = readDeliverables(projDir, reqId, task.id, subLocal);
  const outRoot = subOutputRootOf(projDir, subLocal);

  if (!delExists) {
    return { delExists, checks: [{ desc: "交付登记缺失（登记件走 gd seat deliver）", ok: false }] };
  }
  const missing = scopes.filter((d) => !existsSync(join(outRoot, d)));
  if (missing.length > 0) {
    return { delExists, checks: [{ desc: `登记文件缺失：${missing.join(" / ")}`, ok: false }] };
  }
  return { delExists, checks: scopes.map((d) => ({ desc: `已交付 ${d}`, ok: true })) };
}

/**
 * 收集需求各任务的交付物（绝对路径）：交货单登记的**活跃件作用域**（file = path；package = 件根）。
 * 交付物在 producer 仓库（subLocals[agent]），subLocal 缺失时回退共享区项目根（兼容旧数据）。
 * retired 条目经 readDeliverables 已原地过滤。
 * @param {Record<string,string>} subLocals agent → producer 本地仓库根
 */
export function collectTaskDeliverables(projDir, reqId, tasks, subLocals = {}) {
  const out = [];
  for (const t of tasks) {
    const subLocal = subLocals[t?.executor ?? t?.agent] ?? null;
    const outRoot = subOutputRootOf(projDir, subLocal);
    const { paths } = readDeliverables(projDir, reqId, t.id, subLocal);
    for (const d of paths) {
      const p = join(outRoot, d);
      if (existsSync(p)) out.push(p);
    }
  }
  return out;
}


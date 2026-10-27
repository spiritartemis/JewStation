/**
 * 任务目标（`task-list.executor` 字段）合法性判据 —— **包内自足的核心**（席位 CLI 与总控面共用同一份判断）
 *
 * 口径（**0.16.8 修订**；权威源 `entry/workflow/seatflow.md` §1 · §11.3）：
 *   `executor` = **席位 id**（外派）/ **席位内 worker id**（显式指定路由）/ **本机自产哨兵**（`manager`）/
 *   **板内名册 id**（0.19.0 C3 · 会话模式：`<projDir>/board.yaml` 的 `executors[]`，缺省 `local`）。
 *   - 席位目标 → 项目席位表 `seats/index.yaml`（外协席位如 `test-user` 亦在此）
 *   - worker 目标 → 席位表里某个席位的 `seat_workers[].id`（worker id 全表唯一 ⇒ 可唯一反查归属席位）；
 *     **归属席位**随结果给出（`seat`），派单 / 指令面据此落 `commands/<席位>/`
 *   - 自产目标 → `SELF_SEAT_ID`（`manager`）
 *   - 存量插槽 id → 由**调用方**给出（`legacyIds`，见 `tasktarget.mjs`：仅未迁移项目）
 *
 * **为何与 `tasktarget.mjs` 分两个文件**：席位 CLI（`scripts/seats/seat.mjs`）也要同一套判据，而席位包有
 *   **闭包不逃逸**硬约束（`lib/seatpack.mjs: seatCliClosure`：相对导入必须落在 `scripts/` 内）；
 *   `tasktarget.mjs` 为支持未迁移项目的存量插槽 id 要 import `lib/manifest.mjs`，而 manifest 会拉
 *   `../../.pi/extensions/gd-shared/agents.ts` ⇒ 席位 CLI **不能** import 它（实测：席包装包即报「闭包逃逸」）。
 *   于是判据本体落在这里（只依赖 `seats.mjs` / `taskagent.mjs`，都在包内）。**判据仍是一份。**
 *
 * 消费方：`tasktarget.mjs`（总控面：`task-gen` / `task-add` / `task-dispatch` / `contract-check`）·
 *   席位侧 `gd seat task <dispatch|add>`（0.16.8：席位写入面也过同一套判据）。
 */
import { readBoardConfig } from "./board-resolve.mjs"; // 0.19.0 C3：板内名册 = 会话语义下的合法执行体
import { isSelfSeat, SELF_SEAT_ID } from "./taskagent.mjs";

/** 席位表读取注册位（0.19.0 C6：core 不再 import 席位实现；app 侧在 composition root 注册） */
let seatTableReader = null;

/** app 侧注册入口（CLI 启动调用；不注册 ⇒ core 视作「无席位表」——纯 core 宿主的正确语义） */
export function registerSeatTableReader(fn) {
  seatTableReader = typeof fn === "function" ? fn : null;
}

/** 读席位表（未注册 ⇒ 空表） */
function readSeatTable(projDir) {
  if (typeof seatTableReader !== "function") return { present: false, seats: [] };
  return seatTableReader(projDir) ?? { present: false, seats: [] };
}

/** 插槽 builtin 槽位 id（非任务目标——仅作报错文案用） */
const BUILTIN_SLOT = "main";

/** 可用目标清单（在册席位 ∪ 在册席位内 worker ∪ 本机自产哨兵 ∪ 存量插槽；去重保序）。
 *  退役席位**及其 worker** 不接新单，故不列。 */
function knownTargetIds(seats, legacyIds = [], boardIds = []) {
  const live = seats.filter((s) => s.status !== "retired");
  const ids = [...live.map((s) => s.id), ...live.flatMap((s) => (s.seat_workers ?? []).map((w) => w?.id).filter(Boolean))];
  return [...new Set([...ids, ...boardIds, SELF_SEAT_ID, ...legacyIds])];
}

/** 不合法目标的统一人读说明（报错文案共用，避免各写一套口径） */
function invalidReason(agentId) {
  if (agentId === BUILTIN_SLOT)
    return `"${BUILTIN_SLOT}" 已非任务目标（0.11.0 起本机自产哨兵 = "${SELF_SEAT_ID}"；存量项目跑 node scripts/seats/seat-table-migrate.mjs 收敛）`;
  return `目标 "${agentId}" 非法：既非项目席位 id / 本机自产哨兵（${SELF_SEAT_ID}），也非在册席位内 worker id（worker 必须在席位表 seat_workers 里登记）——登记：gd seat register-worker <席位id> --worker ${agentId} --type trained --repo <producer 仓路径> --identity <Codename>（并行检查：gd agent verify --all）`;
}

/**
 * 解析任务目标（**判据唯一入口**：合法性与退役闸门都在此；不含「存量插槽」分支——那是 `tasktarget.mjs` 的事）。
 * @param {string} projDir 项目库目录
 * @param {string} agentId 待判定的执行方 id
 * @param {{ legacyIds?: string[], doc?: object }} [opts] `legacyIds` 由调用方给（未迁移项目的存量插槽）；
 *   `doc` 可注入已读出的席位表（省一次读盘；不传则本函数自读）
 * @returns {{ ok: boolean, agentId: string, kind: "seat"|"worker"|"self"|"legacy-agent"|"invalid",
 *             seat: object|null, reason: string|null, known: string[] }}
 *   - `kind: "seat"` → 席位表命中（**retired 席位不可接新单 → ok:false**）
 *   - `kind: "worker"` → 席位内 worker 直指；`seat` = **归属席位**（派单 / 指令面据此落 `commands/<席位>/`）
 *   - `kind: "self"` → 本机自产哨兵（`manager`）
 *   - `kind: "legacy-agent"` → 调用方给的存量插槽 id（仅未迁移项目）
 *   - `kind: "invalid"` → 非法（builtin `main` / 未登记 id）
 *   优先级：席位 id > worker id（席位表若同时占用了同一个 id，按席位解，便于存量收敛）。
 */
export function resolveSeatTarget(projDir, agentId, { legacyIds = [], doc = null, boardExecutors = null } = {}) {
  const seats = (doc ?? readSeatTable(projDir)).seats ?? [];
  // 0.19.0 C3：板内名册（`<projDir>/board.yaml` 的 executors）= 会话模式下的合法执行体；
  //   app 层注册的席位 / worker 与它**取并集**（设计 §8 泳道：上层扩容名册，不改判据）。
  const boardIds = (boardExecutors ?? readBoardConfig(projDir).executors?.map((e) => e.id) ?? []).filter(Boolean);
  const known = knownTargetIds(seats, legacyIds, boardIds);
  const seat = seats.find((s) => s.id === agentId) ?? null;
  if (seat) {
    if (seat.status === "retired") return { agentId, seat, known, ok: false, kind: "seat", reason: `席位 "${agentId}" 已退役（retired）——不可接新单` };
    return { agentId, seat, known, ok: true, kind: "seat", reason: null };
  }
  // 席位内 worker 直指（0.16.8）：worker id 全表唯一 ⇒ 归属席位反查唯一
  const owner = seats.find((s) => (s.seat_workers ?? []).some((w) => w?.id === agentId)) ?? null;
  if (owner) {
    if (owner.status === "retired")
      return { agentId, seat: owner, known, ok: false, kind: "worker", reason: `席位 "${owner.id}" 已退役（retired）——其 worker "${agentId}" 不可接新单` };
    return { agentId, seat: owner, known, ok: true, kind: "worker", reason: null };
  }
  const base = { agentId, seat: null, known };
  if (boardIds.includes(agentId)) return { ...base, ok: true, kind: "session", reason: null }; // 板内名册：会话/人的手
  if (isSelfSeat(agentId)) return { ...base, ok: true, kind: "self", reason: null };
  if (legacyIds.includes(agentId)) return { ...base, ok: true, kind: "legacy-agent", reason: null };
  return { ...base, ok: false, kind: "invalid", reason: invalidReason(agentId) };
}

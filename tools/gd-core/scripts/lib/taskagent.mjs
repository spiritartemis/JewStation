/**
 * task-list `agent` 字段的**本机自产哨兵** —— 单一事实源（0.11.0 M6）
 *
 * 背景：`task-list.yaml` 的 `agent` 有两种语义 ——
 *   ① **席位 id**（外派：外协已登记席位，如 `test-user`）→ 走 `commands/<seat>/` 派单；
 *   ② **本机自产**（派给本机席位 `manager` → 写 `commands/manager/CMD-*.yaml`，守护按能力路由到 worker）→ 本模块的哨兵值。
 *
 * 哨兵值 = 本机席位 id（`manager`）——工位层，与身份 `user` 字段隔离（身份已回退，不再同字符串）。
 *   协议 `entry/workflow/seatflow.md` §11.3 · `archive/gd-workstation-0.11.0-manager-identity-design.md`。
 *
 * **别混**（同字符串但不同命名空间）：
 *   · git 分支 `main`（不是哨兵）
 *   · `gd.layout.yaml` 的 `main:` 段（总控仓登记，不是哨兵）
 *   · 插槽注册的 `main` 槽位（`agents-sync.mjs` 身份段注入，不是哨兵）
 *
 * **命名口径**：本模块符号一律沿「**自产 / 外派**」轴（`SELF_SEAT_ID` / `isSelfSeat`）——
 *   · 不嵌具体值（不叫 `MANAGER_*`：席位一旦改名，符号名会再漂一次）
 *   · 不用 `local` / `remote`（那是席位表 `kind` 轴：`test-user` 即 `kind: local` 的**外派**席位）
 *
 * 消费方：`task-dispatch` / `task-gen` / `task-add` / `contract-check` / 席位侧 `task list --mine` 面。
 */

/** 本机自产席位 id（= 本机席位 id `manager`；原 `main`，0.11.0 改名，身份回退 user 后值不变） */
export const SELF_SEAT_ID = "manager";

/** 是否为「本机自产」目标 */
export function isSelfSeat(v) {
  return v === SELF_SEAT_ID;
}

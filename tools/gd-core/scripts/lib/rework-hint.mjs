/**
 * rework-hint —— 「done 态怎么返工」的**单源**指引（0.49.2 B-gm-000038）
 *
 * ## 缺陷本体（0.49.2）
 *
 * `gd task show` 与 `gd-core task show` 在 `done` 态都给：
 *   `终态；要返工：gd work claim <id>（done → in_progress）后重新交件`
 * 而 `gd work claim` 的闸门（`scripts/work.mjs:claimCore`）对 `review` / `done` **一律拒**：
 *   `任务 X 当前 done——不接新认领（review/done 归验收面）`
 * ⇒ **指引指了一条被自己闸门拒掉的路**。用户照做必然失败，且失败信息还会把人引向
 *   「是不是我参数不对」，而真正的问题是「这条路本来就不通」。
 *
 * ## 为什么不改闸门、只改指引
 *
 * `claimCore` 拒 `review` / `done` 是**有意的**：认领是「接手干活」的入口（带租约、可被接管），
 * 让它可以重开已验收的任务 = 「已验收」可被静默重开，验收结论就失去意义。
 * 真实通道是**验收面的 reject**——`applyCheck`（`lib/board-actions.mjs`）对 `review` / `done`
 * 都接受，`--reject` ⇒ 回 `in_progress`，并落一条 `review: {verdict: reject, note}` 留痕。
 * 席位面同口径（`gd seat task reject`，`scripts/seats/seat.mjs:2342`）。
 *
 * ## 判据（本模块存在的理由）
 *
 * **指引必须指一条闸门真的放行的路。** 所以这里不手写命令串，而是：
 *   ① 从 `TASK_TRANSITIONS`（状态机的单一事实源）确认 `done → in_progress` 合法；
 *   ② 只在合法时才给出唯一那个入口（`check --reject`）。
 * 两件事分开：**能不能重开**问状态机，**用哪条命令重开**问验收面。手写命令就会各自漂移。
 *
 * 内核零宿主名词：命令前缀（`gd` / `gd-core` / …）由调用方传入，本模块不认宿主。
 */
import { TASK_TRANSITIONS } from "./board.mjs";

/**
 * 重开已终态任务的那个入口（唯一）。
 * 加新入口前先问：它和 `claimCore` 的「review/done 归验收面」是不是又打架了。
 */
export const REWORK_ENTRY = Object.freeze({
  /** 验收面命令（板面 `gd` / 内核面 `gd-core` 同名子命令） */
  sub: "check",
  /** 打回旗标（`--pass` 只对 review 生效，`--reject` 对 review / done 都生效） */
  flag: "--reject",
});

/**
 * `done` 态的下一步提示（唯一合法动作）。
 *
 * @param {{ id: string, prefix?: string }} p `prefix` = 命令前缀（缺省 `gd`）
 * @returns {string} 一行提示；状态机不允许重开时如实说「终态」而不是给一条假路
 */
export function doneReworkHint({ id, prefix = "gd" }) {
  const reopenable = (TASK_TRANSITIONS.done ?? []).includes("in_progress");
  if (!reopenable) return "终态（不可再流转）";
  return `终态；要返工：${prefix} ${REWORK_ENTRY.sub} ${id} ${REWORK_ENTRY.flag} "原因"（done → in_progress）后重新交件`;
}

/**
 * 板上下文定位（0.19.0 R-gm-004 / T-03 · core 层）
 *
 * 用途：把「按任务 id 找到它所在的板 + 账 + 条目」这一件小事收成一处，供 **owner 侧命令**
 *   （`gd handoff` / `gd check`）在板模式下复用——它们原先只认注册表项目（`locateTask`）。
 *
 * 口径（与 `gd work` 完全一致，三条闸门）：
 *   ① 板必须能解析出来（`GD_BOARD` / 自举 / 注册表注入）；
 *   ② 板必须是**会话语义**（`mode !== "seat"`）——席位语义的板，任务写面仍归席位自己的面；
 *   ③ 任务 id 前缀必须等于板 id（`T-<板id>-…`）——防止在 A 板命令里误操作 B 的账。
 *
 * 依赖方向：core（`board-resolve` + `board`）。
 */
import { artifactBasis, resolveBoard } from "./board-resolve.mjs";
import { findTaskAnywhere } from "./board.mjs";

/**
 * @param {string} taskId
 * @param {{reqId?: string|null, cwd?: string}} [opts]
 * @returns {{ok: true, board: object, projDir: string, artifactRoot: string, reqId: string, task: object}
 *          | {ok: false, error: string, hint?: string[]}}
 */
export function locateBoardTask(taskId, { reqId = null, cwd = process.cwd() } = {}) {
  if (!taskId) return { ok: false, error: "缺任务 id" };
  const rb = resolveBoard({ cwd });
  if (!rb.board) {
    return {
      ok: false,
      error: `未定位到板（${"三处皆无"}）`,
      hint: ["建板：gd core init   · 临时切板：export GD_BOARD=<板根目录>"],
    };
  }
  if (rb.board.error) return { ok: false, error: `板配置不合法：${rb.board.error}` };
  const board = rb.board;
  if (board.mode === "seat") {
    return {
      ok: false,
      error: `板 ${board.id} 处于席位语义（<板根>/seats/index.yaml 存在）——任务写面在席位自己的面上`,
      hint: ["等价路径：gd seat task handoff|accept|reject（席位上下文）"],
    };
  }
  if (!String(taskId).startsWith(`T-${board.id}-`)) {
    return {
      ok: false,
      error: `任务 "${taskId}" 不属于本板（板 id ${board.id}，任务 id 前缀应为 T-${board.id}-）`,
      hint: ["在别的板 / 注册项目里就用那边的上下文：cd 到该仓，或 GD_BOARD=<板根>"],
    };
  }
  const hit = findTaskAnywhere(board.root, taskId);
  if (!hit) return { ok: false, error: `任务 ${taskId} 不在本板的任何需求账里` };
  if (reqId && String(hit.reqId) !== String(reqId)) {
    return { ok: false, error: `任务 ${taskId} 属于 ${hit.reqId}，与 --req ${reqId} 不符` };
  }
  return { ok: true, board, projDir: board.root, artifactRoot: artifactBasis(board.root), reqId: hit.reqId, task: hit.task };
}

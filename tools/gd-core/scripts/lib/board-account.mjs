/**
 * 板域判定（board account）—— **core 层**的落点判定（0.23.0 R-gm-046-01）
 *
 * gd 有两本账（见 `target-guard.mjs`）：**板账**（core）与**注册项目账**（app）。core 只认板：
 *   它没有注册表、没有引导、没有席位——所以「写哪本账」在 core 里是**伪问题**，只有「本仓有没有板」。
 *
 * 判据（与 app 侧 `target-guard.mjs` 的板分支**同一形状**，只是去掉注册表那条路）：
 *   ① 显式 `--board` / 显式板根 ⇒ 有板即落板；没板 ⇒ `none`（不猜）
 *   ② `GD_BOARD` 显式切板 ⇒ 板
 *   ③ id 前缀属本板（`R-<板id>-…` / `B-…` / `T-…`）⇒ 板
 *   ④ 默认：cwd 所在 git 仓自举（`<git-common-dir>/gdtwork`，`--in-tree` 摆法亦认）⇒ 板
 *   ⑤ 都没有 ⇒ `none`，调用方用 `noBoardMessage()` 指路（`gd core init` / `export GD_BOARD=…`）
 *
 * 注意 ③ 只判「属本板」；**不**判「属另一块板或某个注册项目」——那需要注册表（app 概念）。
 *   点错命名空间由命令层用 `idInNamespace()` 明确报错（如拆任务命令的「需求不属于本板」）。
 *
 * 依赖方向：只依赖 core 基元（`board-resolve.mjs` / `reqid.mjs`），**不 import 注册表 / 引导 / 席位**。
 */
import { boardMissingHint, resolveBoard } from "./board-resolve.mjs";
import { idInNamespace } from "./reqid.mjs";

/**
 * 板候选扫描（只读 · 不 contain 注册表注入）。
 * @param {{cwd?: string, env?: object, boardRoot?: string|null}} [o]
 * @returns {{board: object|null, source: string|null, searched: string[]}}
 */
export function boardCandidates({ cwd = process.cwd(), env = process.env, boardRoot = null } = {}) {
  const rb = resolveBoard({ cwd, env, boardRoot });
  const accessible = rb.source === "arg" || rb.source === "env" || rb.source === "self";
  return { board: rb.board && accessible ? rb.board : null, source: rb.board && accessible ? rb.source : null, searched: rb.searched ?? [] };
}

/** id 是否属本板（`R-<板id>-…` / `B-…` / `T-…`）——编号命名空间即判据 */
export function idBelongsToBoard(board, id) {
  return idInNamespace(board?.id, id);
}

/**
 * 落点判定（core 面 · 单一实现）。
 *
 * @param {{cwd?: string, env?: object, boardRoot?: string|null, wantBoard?: boolean, id?: string|null}} [o]
 * @returns {{mode: "board"|"none", board: object|null, source: string|null, why: string, note: string|null}}
 */
export function resolveBoardAccount({ cwd = process.cwd(), env = process.env, boardRoot = null, wantBoard = false, id = null } = {}) {
  const cand = boardCandidates({ cwd, env, boardRoot });
  const b = cand.board;
  const onBoard = (why, note = null) => ({ mode: "board", board: b, source: cand.source, why, note });

  // ① 显式点板：有板即落板，没板不猜
  if (wantBoard || boardRoot) {
    if (b) return onBoard(boardRoot ? "显式板根" : "显式 --board");
    return { mode: "none", board: null, source: null, why: "指定了 --board，但本仓没有板", note: null, searched: cand.searched };
  }
  // ② GD_BOARD 显式切板
  if (cand.source === "env" && b) return onBoard("GD_BOARD 显式切板");
  // ③ id 前缀属本板
  if (id && b && idBelongsToBoard(b, id)) return onBoard(`id 前缀属板 ${b.id}`);
  // ④ 默认：本仓的板
  if (b) return onBoard("默认落本仓的板");
  // ⑤ 无板
  return { mode: "none", board: null, source: null, why: "本仓没有板（未 gd core init）", note: null, searched: cand.searched };
}

/**
 * 落点失败的统一指路文案（`mode === "none"` 时调用方打）。
 * core 面**不提供**「走注册项目账」的出口——那是 app 面（完整 CLI）。
 */
export function noBoardMessage(command, acct) {
  const cli = command.startsWith("gd-core ") ? `gd ${command.slice("gd-core ".length)}` : command;
  return [
    `${command}：未定位到板（${acct?.why ?? "本仓没有板"}）`,
    boardMissingHint(acct?.searched ?? []),
    `  · 注册项目账属 app 面（需注册表）：用完整 CLI \`${cli} --project <项目id>\``,
  ].join("\n");
}

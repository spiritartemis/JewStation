#!/usr/bin/env node
/**
 * core-cap —— **core 层**的能力层命令（m-6 · capability-layer · 0.61 R-gm-61-0）
 *
 * 命令面（core 自足，只认板账）：
 *   gd-core cap new "<能力标题>" --id <能力id> [--purpose "…"] [--carrier "kind:定位"…]
 *   gd-core cap list [--prefix <id前缀>] [--status active|retired] [--json]
 *   gd-core cap show <能力id> [--json]
 *   gd-core cap update <能力id> [--title "…"] [--purpose "…"] [--status active|retired] [--carrier …]
 *   gd-core cap req add <能力id> --title "…" --must "…" --scenario "名称|WHEN|THEN"…
 *   gd-core cap req update <能力id> <R#> …        gd-core cap req remove <能力id> <R#>
 *   gd-core cap fulfill <能力id> [--req <R#>…] --evidence "…"…（0.68.1 起改名为 fulfill）
 *   gd-core cap history <能力id>
 *   gd-core cap bind <需求id> --capability <能力id> [--delta <板根相对路径>] [--role owner|consumer]
 *   gd-core cap draft <需求id> [--write]（能力影响面 + delta 草稿）
 *   gd-core cap merge <能力id> --req <需求id> [--dry-run]
 *   gd-core cap export <能力id> [--out <文件>]      gd-core cap import <能力id> --file <delta.md> --req <需求id>
 *
 * 为什么是 core：能力层是**板账内**的一等实体（与需求 / 里程碑同域），不依赖注册表 / 席位 / 工作站
 *   ⇒ 只装 `gd-core` 的宿主也要能立能力、读判据。取数与写入在 `lib/capability-ledger.mjs`（完整 CLI 与本族共用
 *   同一份实现，避免两处口径分歧）。
 *
 * 与完整 CLI 的关系：`gd cap`（域侧 scripts/reqs/cap.mjs）与本族**同一实现**（`lib/capability-cli.mjs: runCap`），
 *   差别只是落点判定走 core 口径（`lib/board-account.mjs`：只认板，无板即指路，不猜路径）。
 */
import { parseArgs } from "./lib/args.mjs";
import { runCap } from "./lib/capability-cli.mjs";

/** core 面支持的能力子命令（全族：能力层无 app 依赖，四个子命令都属 core） */
export const CAP_CORE_SUBCOMMANDS = ["new", "list", "show", "update", "req", "fulfill", "history", "bind", "draft", "merge", "export", "import"];

/**
 * 分发给能力层实现（把子命令名拼回 argv，实现侧只认一种入参形态）。
 * @param {string} sub 子命令
 * @param {string[]} argv 子命令之后的参数
 */
export function runCapCore(sub, argv = []) {
  return runCap([String(sub ?? ""), ...argv]);
}

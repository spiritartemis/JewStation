/**
 * `gd core version` —— **板上**总控版本号（只读 · 0.24.2 R-gm-085）。
 *
 * 为什么要有这个只读入口：总控版本号有两条取法（板 vs manifest 登记副本），
 *   两个写端（CLI `gd agents-sync` / TUI 管理面板）各自算一次，就会把同一个
 *   `.pi/APPEND_SYSTEM.md` 写出两个版本号、谁后跑谁赢 ⇒ 文件在两个号之间跳。
 *   把「板上的真值」收成一个可查询的入口，两写端都问它 ⇒ 天然同源。
 *
 * 输出（`--json`）：`{ version, source, boardId }`
 *   · `version` 非 null ⇒ 板上**版本号最大**的已结版子版（真相）
 *   · `version` 为 null ⇒ 本机没有板，或板上还没有已结版子版
 *     ⇒ 调用方按自己的档位回落（CLI 回落 manifest 登记副本 / roadmap 顶行；TUI 回落 manifest）
 *
 * 依赖方向：core 层（只读板账 + git 工作区），零 import app。
 */
import { resolveMainVersion } from "./lib/main-version.mjs";
import { out, errOut } from "./lib/style.mjs";

/** CLI 旗标（core 家族统一：`--json` 只读） */
export const CLI_FLAGS = ["--json"];
export const CLI_USAGE = "  gd core version [--json]   板上总控版本号（只读：版本号最大的已结版子版；无板/未结版 ⇒ version=null，调用方回落登记副本）";

/**
 * 执行 `core version`。
 * @param {{json?: boolean, cwd?: string, env?: object}} args
 * @returns {number} exit code
 */
export function runCoreVersion(args = {}) {
  const r = resolveMainVersion({ cwd: args.cwd ?? process.cwd(), env: args.env ?? process.env });
  if (args.json) {
    console.log(JSON.stringify({ ok: true, version: r.version, source: r.source, boardId: r.boardId }, null, 2));
    return 0;
  }
  if (r.version) {
    console.log(out.ok(`总控版本（板 ${r.boardId ?? "?"}）：${r.version}`));
    return 0;
  }
  console.log(out.warn("板上无已结版子版（或本机无板）——version=null，调用方回落 manifest 登记副本 / roadmap 顶行"));
  return 0;
}

// 独立可执行（供 TUI 侧 spawn 问值：node scripts/core-version.mjs --json）
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scripts/core-version.mjs")) {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const unknown = argv.filter((a) => a.startsWith("--") && a !== "--json");
  if (unknown.length) {
    console.error(errOut.err(`✗ 未知参数：${unknown.join(" ")}\n${CLI_USAGE}`));
    process.exit(1);
  }
  process.exit(runCoreVersion({ json }));
}

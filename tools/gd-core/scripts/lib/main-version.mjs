/**
 * 总控版本号单一事实源（0.24.2 R-gm-085）——**有板以板为准，无板回落登记副本**。
 *
 * 背景（2026-10-22 实测）：总控版本号有三条取法散在两处写端里———
 *   · CLI 写端（`scripts/agents/agents-sync.mjs`）：板上最大已结版子版 → roadmap 顶行 → manifest；
 *   · TUI 写端（`.pi/extensions/gd-manager/data.ts`）：manifest 登记值。
 * 板与登记一旦不同步（刚结版还没回写 manifest），两个写端会把同一个
 * `.pi/APPEND_SYSTEM.md` 写出**两个不同版本号**，谁后跑谁赢 ⇒ 文件在两个版本号之间来回跳。
 *
 * 本模块把「板上的真值」收敛为**单一实现**：谁想知道总控版本号，都来这里问。
 *   ① 有板 ⇒ 板上**版本号最大**的已结版子版（真相 · G11 同源）；
 *   ② 无板 ⇒ null（调用方回落 manifest 登记副本 / roadmap 顶行——那两档在 app 层，各写端已有）。
 *
 * 依赖方向：core 层（只依赖板账与 git 工作区），**不 import app**（manifest / 顶行读取留给调用方）。
 */
import { resolveBoard } from "./board-resolve.mjs";
import { readSubvers, latestClosedSubver } from "./subvers.mjs";

/**
 * 板上的总控版本号（只读）。
 *
 * @param {{cwd?: string, env?: object, mainLocal?: string|null}} [o]
 *   · `cwd` / `mainLocal`：板探测的落点（一般传总控仓根；`GD_BOARD` 优先）
 * @returns {{version: string|null, source: "board"|null, boardId: string|null}}
 *   `version = null` ⇒ 本机没有板（或板上还没有已结版子版）⇒ 调用方按自己的档位回落。
 */
export function resolveMainVersion({ cwd = process.cwd(), env = process.env, mainLocal = null } = {}) {
  const where = mainLocal || cwd;
  try {
    const rb = resolveBoard({ cwd: where, env });
    if (!rb || !rb.board || rb.board.error) return { version: null, source: null, boardId: null };
    const sv = readSubvers(rb.board.root);
    const version = sv.ok ? latestClosedSubver(sv.list) : null;
    if (!version) return { version: null, source: null, boardId: rb.board.id ?? null };
    return { version, source: "board", boardId: rb.board.id ?? null };
  } catch {
    return { version: null, source: null, boardId: null };
  }
}

/**
 * G11 登记值判定（纯函数 · 0.45 补）。
 *
 * 为什么要单独立一条：原 G11 只判「落后 / 低于」，把「**值本身是坏的**」当成「还没登记」轻轻放过。
 *   2026-10 实测：手/旁路写入 `gdmain_version: null` ⇒ 读取得到字符串 `"null"` ⇒
 *   `compareVersions("0.44.0","null")` 逐段比 NaN、一路不命中 ⇒ 返回 0 ⇒ **判「与板一致」**，
 *   于是一个坏值在仓位里躺了两天，任何门禁都没响。
 *
 * 判据顺序（先判「是不是版本号」，再判「对不对」）：
 *   ① 空值写法（`null` / `~` / `undefined` …）⇒ **坏值**。这既不是版本号也不是「没登记」，
 *      而是有人把派生字段写坏了 —— 必须拦，不能警告。
 *   ② 板上已有已结版子版 ⇒ 登记值必须是 `x.y.z` 形态；占位（空 / `0.0.0` / `TBD`）也算**未登记** ⇒ 坏值。
 *      理由：板上有已收口的版本，登记副本却空着 ⇒ 这份副本已经失真，不是「还没到时候」。
 *   ③ 形态合法 ⇒ 再比大小：落后 / 低于都是 **warn**（不拦截；同步会回填，见 versioning.md §3）。
 *
 * @param {{raw: string|null, boardLatest: string|null, roadmapVersion?: string|null}} i
 * @returns {{level: "ok"|"warn"|"fail", code: string|null, desc: string}}
 */
export function judgeMainVersionRegistration({ raw, boardLatest, roadmapVersion = null }) {
  const CANON = /^\d+\.\d+\.\d+$/;
  const JUNK = /^(null|nil|none|~|undefined)$/i;
  const PLACEHOLDER = (v) => !v || v === "0.0.0" || v === "TBD";
  const s = String(raw ?? "").trim();

  if (JUNK.test(s)) {
    return {
      level: "fail",
      code: "E_MAINVER_BAD",
      desc: `manifest 登记值被写坏（读到 "${s}"，不是版本号；板上最新已结版子版 ${boardLatest ?? "—"}）—— 派生字段被旁路写坏，不是「还没登记」：修法 node scripts/agents/agents-sync.mjs --apply`,
    };
  }
  if (boardLatest) {
    if (!CANON.test(s)) {
      return {
        level: "fail",
        code: "E_MAINVER_BAD",
        desc: `manifest 登记值不是版本号形态（读到 "${s || "（空）"}"；板上最新已结版子版 ${boardLatest}）—— 板上有已收口的版本，这份登记副本却空着/形态不对 ⇒ 已失真：修法 node scripts/agents/agents-sync.mjs --apply`,
      };
    }
    const pa = s.split(".").map(Number);
    const pb = String(boardLatest).split(".").map(Number);
    let cmp = 0;
    for (let k = 0; k < Math.max(pa.length, pb.length); k++) {
      const a = pa[k] ?? 0;
      const b = pb[k] ?? 0;
      if (a > b) { cmp = 1; break; }
      if (a < b) { cmp = -1; break; }
    }
    if (cmp < 0) {
      return { level: "warn", code: null, desc: `登记值落后（manifest ${s} → 板上最新子版 ${boardLatest}，同步可回填：node scripts/agents/agents-sync.mjs --apply）` };
    }
    if (cmp > 0) {
      return { level: "warn", code: null, desc: `低于登记值（板上最新子版 ${boardLatest} < manifest ${s}，降级不回写）` };
    }
    return { level: "ok", code: null, desc: `与板一致（${s}）` };
  }
  // 无板：回落 roadmap 顶行（顶行是板驱动前的手写登记面，仍服务无板仓）
  const rv = String(roadmapVersion ?? "").trim();
  if (PLACEHOLDER(s)) {
    return {
      level: "warn",
      code: null,
      desc: rv ? `manifest 未登记总控版本（roadmap ${rv}，同步可回填：node scripts/agents/agents-sync.mjs --apply）` : "manifest 未登记总控版本（板上尚无已结版子版，同步会回填：node scripts/agents/agents-sync.mjs --apply）",
    };
  }
  if (!CANON.test(s)) {
    return { level: "fail", code: "E_MAINVER_BAD", desc: `manifest 登记值不是版本号形态（读到 "${s}"）—— 修法 node scripts/agents/agents-sync.mjs --apply` };
  }
  if (!rv) return { level: "ok", code: null, desc: `登记值形态合法（${s}；本机无板、roadmap 顶行也无标注）` };
  if (!CANON.test(rv)) return { level: "warn", code: null, desc: `roadmap 顶行版本标注格式不规范（读到 "${rv}"；应为「版本号：x.y.z」三段式）` };
  const pa = s.split(".").map(Number);
  const pb = rv.split(".").map(Number);
  let cmp = 0;
  for (let k = 0; k < Math.max(pa.length, pb.length); k++) {
    const a = pa[k] ?? 0;
    const b = pb[k] ?? 0;
    if (a > b) { cmp = 1; break; }
    if (a < b) { cmp = -1; break; }
  }
  if (cmp < 0) return { level: "warn", code: null, desc: `登记值落后（manifest ${s} → roadmap ${rv}，同步可回填：node scripts/agents/agents-sync.mjs --apply）` };
  if (cmp > 0) return { level: "warn", code: null, desc: `低于登记值（roadmap ${rv} < manifest ${s}，降级不回写，见 versioning.md §3）` };
  return { level: "ok", code: null, desc: `版本登记一致（${s}）` };
}

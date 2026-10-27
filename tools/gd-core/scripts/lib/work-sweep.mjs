/**
 * work-sweep —— 工作区清扫的**判定与留痕**（core 层 · 0.45 T-gm-45-0-02 · R-gm-45-0）
 *
 * 问题：`gd work land` 会因为「人在里面 / 有外部联接 / 回收失败」把工作区**保留**下来，
 *   于是 `kept` 越攒越多。攒下来之后没人再管 —— 谁的任务、为什么没回收、什么时候该清，
 *   只有 `landed.cleanup` 里一行字，散在几百个任务账里查不动。
 *
 * 本模块只做两件纯事（git 操作留在 `work.mjs`，好测）：
 *   ① **判定**：一个还在盘上的工作区，该回收 / 该保留 / 保留为什么、什么时候再看；
 *   ② **留痕**：把判定结果追加到 `<板根>/work-sweep.jsonl`（板根在 .git 下，不入版本库）。
 *
 * 三条硬口径（来自 T-gm-45-0-02 的 input 与 B-gm-000010-01 实测）：
 *   1) 回收前先摘**指向外部的联接**；摘不掉 ⇒ **保留并留原因**，不硬删（否则 git 的递归删除穿透 junction，
 *      目标内容被清空 —— 实测主仓 91 个包）。
 *   2) `kept` 必须留清单与原因：哪条任务 / 为什么没回收 / 什么时候再清 —— 可复查。
 *   3) **清扫不碰主工作区**（`repo` 根，以及它下面的 `node_modules` 这种真实目录）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 清扫留痕：`<板根>/work-sweep.jsonl`（板根在 `.git/gdtwork` 下 ⇒ 天然不入版本库） */
export const SWEEP_LOG_REL = "work-sweep.jsonl";
/** 「久未动」默认阈值（天） */
export const DEFAULT_STALE_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * 判定一个工作区该怎么处置。**纯函数**（不碰磁盘、不跑 git）—— 便于 e2e 直接喂输入。
 *
 * @param {object} i
 * @param {string} i.unitId 工作单元 id（`req/R-gm-45-0`）
 * @param {string} [i.branch] 分支名
 * @param {string} i.path 工作区绝对路径
 * @param {string} i.repoRoot 仓根绝对路径（主工作区，**绝不动**）
 * @param {boolean} i.exists 目录是否还在盘上
 * @param {boolean} [i.inCwd] 当前 shell 的 cwd 是否落在它里面
 * @param {string[]} [i.links] 已扫出的**指向外部**的联接绝对路径
 * @param {string[]} [i.openTasks] 单元里**还没归档**（未 land）的任务 id
 * @param {number|null} [i.idleDays] 最近一次活动距今多少天（null = 拿不到证据，按「未知」处理）
 * @param {number} [i.staleDays] 「久未动」阈值，缺省 7
 * @returns {{kind:string, removable:boolean, reason:string, nextCheckDays:number|null, needsUnlink:boolean}}
 */
export function classifyUnit(i) {
  const rawDays = Number(i.staleDays);
  const staleDays = Number.isFinite(rawDays) && rawDays >= 0 ? rawDays : DEFAULT_STALE_DAYS;
  const norm = (p) => String(p ?? "").split("\\").join("/").replace(/\/+$/, "").toLowerCase();
  const pathN = norm(i.path);
  const repoN = norm(i.repoRoot);
  const needsUnlink = (i.links ?? []).length > 0;

  // ① 主工作区：永远不动 —— 既包括仓根本身，也包括**仓根里面**的路径
  //    （后者是真实目录：`node_modules` / `dist` 这些，删它们就是删主仓的依赖）
  if (pathN && repoN && (pathN === repoN || pathN.startsWith(repoN + "/"))) {
    return { kind: "main", removable: false, reason: "这是主工作区（仓根或它里面），清扫一律不碰", nextCheckDays: null, needsUnlink: false };
  }
  // ② 目录已经没了：账上残留 ⇒ 剩下的只是分支与登记，可清
  if (!i.exists) {
    return { kind: "absent", removable: true, reason: "工作区目录已不存在（账上残留）", nextCheckDays: null, needsUnlink: false };
  }
  // ③ 人的 shell 在里面：回收会让 cwd 指向已删除目录（后续 handoff / check 会「未定位到板」）
  if (i.inCwd) {
    return { kind: "cwd", removable: false, reason: "当前目录就在这个工作区里（回收会让 shell 的 cwd 变成已删除目录）", nextCheckDays: staleDays, needsUnlink: false };
  }
  // ④ 单元里还有没归档的活：动它就是动别人的活
  const open = (i.openTasks ?? []).filter(Boolean);
  if (open.length) {
    return { kind: "open", removable: false, reason: `单元里还有未归档任务：${open.join(" / ")}`, nextCheckDays: staleDays, needsUnlink };
  }
  // ⑤ 活都归档了 ⇒ 可回收（先摘联接，摘不掉由调用方改成保留）
  const idle = i.idleDays;
  if (idle !== null && idle !== undefined && idle < staleDays) {
    return { kind: "recent", removable: false, reason: `最近 ${idle} 天内有活动，未到 ${staleDays} 天阈值`, nextCheckDays: Math.max(1, staleDays - idle), needsUnlink };
  }
  return {
    kind: "idle",
    removable: true,
    reason: idle === null || idle === undefined ? `单元内任务已全部 land（无活动时间证据）` : `单元内任务已全部 land，且已 ${idle} 天无活动`,
    nextCheckDays: null,
    needsUnlink,
  };
}

/**
 * 把一批判定结果汇总成一行「人读的账」（`gd work sweep` 的结尾那行）。
 * @param {Array<{kind:string}>} decided
 */
export function summarize(decided) {
  const by = (k) => decided.filter((d) => d.kind === k).length;
  return {
    total: decided.length,
    removable: decided.filter((d) => d.removable).length,
    kept: decided.filter((d) => !d.removable).length,
    unsafeLink: decided.filter((d) => d.kind === "unsafe-link").length,
    absent: by("absent"),
    main: by("main"),
  };
}

/**
 * 追加清扫留痕（一行一条，jsonl）。**只追加**：历史可复查，不做原地改写。
 * @param {string} boardRoot 板根
 * @param {object[]} entries 每条形如 `{at, unit, branch, path, action, kind, reason}`
 * @returns {string} 落盘路径
 */
export function appendSweepLog(boardRoot, entries) {
  const abs = join(boardRoot, SWEEP_LOG_REL);
  if (!entries.length) return abs;
  mkdirSync(boardRoot, { recursive: true });
  appendFileSync(abs, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  return abs;
}

/**
 * 读清扫留痕（可复查：`gd work sweep --history`）。
 * @param {string} boardRoot 板根
 * @param {number} [limit] 只要最近多少条（缺省全部）
 * @returns {object[]}
 */
export function readSweepLog(boardRoot, limit) {
  const abs = join(boardRoot, SWEEP_LOG_REL);
  if (!existsSync(abs)) return [];
  const rows = readFileSync(abs, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return limit ? rows.slice(-limit) : rows;
}

/**
 * 「什么时候再清」人读化。
 * @param {number|null} days
 */
export function nextCheckText(days) {
  if (days === null || days === undefined) return "";
  const at = new Date(Date.now() + Number(days) * DAY_MS).toISOString().slice(0, 10);
  return `下次复查 ${at}（${days} 天后）`;
}

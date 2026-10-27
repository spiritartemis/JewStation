/**
 * `scripts/lib/req-brief.mjs` — 工单三块的**唯一计算**（该读什么 / 交了什么 / 怎么算过）
 *
 * 为什么要单拎一份：`gd req status`、`gd req list`、`gd board`（`reqs/req-board.mjs` 与
 *   `lib/board-read.mjs: boardView` 两套渲染器）都要显示「三块齐不齐」。
 *   各算一遍必然漂移 —— 同一个问题在两条命令里必须是同一个答案（长期记忆的元判据）。
 *
 * **只做投影，不引入新事实源**：
 *   · 该读什么 = 条目 `context[]`（写入口 `gd req context add`）
 *   · 交了什么 = 任务级 `artifacts` 汇总（事实源在任务账；需求级 `delivery` 只是副本 + 人工说明）
 *   · 怎么算过 = 条目 `acceptance`（method / criteria / reviewer；`result` 是事后结论，签过才有）
 */
import { normalizeContextList } from "./req-context.mjs";
import { normalizeAcceptance, normalizeDelivery, summarizeDelivery } from "./req-delivery.mjs";
import { readAllLedgers, readReqEntries } from "./board.mjs";

/** 三块的固定顺序与人读名（渲染、缺项文案、e2e 都用这一份） */
export const BRIEF_BLOCKS = [
  { key: "context", label: "该读什么", how: "gd req context add <需求id> --path <仓内路径>" },
  { key: "delivery", label: "交了什么", how: "任务交件走 gd handoff --artifact / gd seat deliver；需求级说明走 gd req delivery note" },
  { key: "acceptance", label: "怎么算过", how: "gd req acceptance set <需求id> --method … --criteria \"…\"" },
];

/**
 * 三块摘要（纯函数，不读盘）。
 * @param {object|null} entry `reqs/index.yaml` 的需求条目（含 context / delivery / acceptance 块）
 * @param {object[]} tasks 该需求的任务（含 `artifacts[]`）
 */
export function briefOfReq(entry, tasks = []) {
  const ctx = normalizeContextList(entry?.context);
  const arts = summarizeDelivery((Array.isArray(tasks) ? tasks : []).map((t) => ({ id: t?.id, executor: t?.executor ?? "", status: t?.status ?? "", artifacts: t?.artifacts ?? [] })));
  const del = normalizeDelivery(entry?.delivery);
  const acc = normalizeAcceptance(entry?.acceptance);
  const criteria = Array.isArray(acc?.criteria) ? acc.criteria : [];
  const note = String(del?.note ?? "").trim();
  const verdict = acc?.result?.verdict ?? null;
  const brief = {
    context: { count: ctx.length, ready: ctx.length > 0 },
    delivery: { count: arts.total, tasks: arts.tasks_with_artifacts, note, ready: arts.total > 0 || note.length > 0 },
    acceptance: {
      method: acc?.method ?? null,
      criteria: criteria.length,
      reviewer: acc?.reviewer ?? null,
      verdict,
      by: acc?.result?.by ?? null,
      at: acc?.result?.at ?? null,
      // 「填过判据」就算这块到位；签没签由 verdict 单独表达（结论是事后才有，不能当齐备度）
      ready: Boolean(acc?.method) || criteria.length > 0 || Boolean(acc?.reviewer) || Boolean(verdict),
    },
  };
  brief.missing = BRIEF_BLOCKS.filter((b) => !brief[b.key].ready).map((b) => b.key);
  brief.allReady = brief.missing.length === 0;
  return brief;
}

/**
 * 一次读全板：`Map<reqId, brief>`。
 *
 * 给**看板类渲染器**用（`gd board` 的 `reqs/req-board.mjs` 与 `lib/board-read.mjs: boardView`）——
 * 它们手上的快照行只有 id/status/tasks，没有 `context` / `acceptance`，必须回条目取。
 * 账缺失的需求（还没建 task-list）也要有 brief：否则看板上它就没有标记，看着像「齐了」。
 */
export function briefsOfRoot(root) {
  const entries = new Map(readReqEntries(root).map((e) => [String(e.id), e]));
  const map = new Map();
  for (const [reqId, ledger] of readAllLedgers(root)) {
    map.set(String(reqId), briefOfReq(entries.get(String(reqId)), ledger.tasks ?? []));
  }
  for (const [id, e] of entries) if (!map.has(id)) map.set(id, briefOfReq(e, []));
  return map;
}

/**
 * 三块齐备度标记（一行内放得下、自解释）：`读✓ 交✓ 验·`
 * 不另画图例 —— 看板 / 清单里没有表头位置，图例放哪儿都会有人看不见。
 */
export function briefMarks(brief) {
  const m = (x) => (x ? "✓" : "·");
  return `读${m(brief?.context?.ready)} 交${m(brief?.delivery?.ready)} 验${m(brief?.acceptance?.ready)}`;
}

/**
 * 三块人读摘要（`gd req status` 用）：**缺哪块就明说缺哪块**，并给出补它的命令。
 * @returns {string[]}
 */
export function briefLines(brief) {
  const b = brief ?? briefOfReq(null, []);
  const lines = [];
  lines.push(
    b.context.ready
      ? `  该读什么   ${b.context.count} 条（gd req context list <需求id> 看全量）`
      : "  该读什么   未填 —— gd req context add <需求id> --path <仓内路径>",
  );
  lines.push(
    b.delivery.ready
      ? `  交了什么   ${b.delivery.count} 件${b.delivery.tasks ? `（来自 ${b.delivery.tasks} 个任务）` : ""}${b.delivery.note ? " · 另有需求级说明" : ""}`
      : "  交了什么   未填 —— 任务交件走 gd handoff --artifact；需求级说明走 gd req delivery note",
  );
  if (b.acceptance.ready) {
    const bits = [b.acceptance.method ?? "方法未填", `判据 ${b.acceptance.criteria} 条`];
    if (b.acceptance.reviewer) bits.push(`验收人 ${b.acceptance.reviewer}`);
    bits.push(b.acceptance.verdict ? `结论 ${b.acceptance.verdict}${b.acceptance.by ? ` by ${b.acceptance.by}` : ""}` : "结论 未签");
    lines.push(`  怎么算过   ${bits.join(" · ")}`);
  } else {
    lines.push('  怎么算过   未填 —— gd req acceptance set <需求id> --method … --criteria "…"');
  }
  return lines;
}

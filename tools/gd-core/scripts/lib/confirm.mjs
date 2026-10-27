/**
 * 高危动作确认闸门（0.21.8）—— **铁律的机器侧**：结版 / 退档 / 折叠必须"点名"才执行。
 *
 * 它**不能**证明"用户点了头"（agent 自己能加旗标）；它能做到两件实事：
 *   ① **防手滑与批量误伤**：`--confirm <目标id>` 必须与目标**逐字相等**，批量/拼错/拿旧脚本重跑都会被拦；
 *   ② **留痕**：调用方把 `confirmedBy` 写进事件，事后可追"这次结版是谁点名的"。
 * 人的点头仍由纪律保证（protocol §3.6 第 4 条）；机器守住"不点名不动手"这一半。
 */

/** 里程碑序号（`m-3` / `m3` / `3` 都归一成 3；非数字形态返回 null）——与 `findMilestone` 同口径 */
function milestoneNoOf(v) {
  // 新模型 id（`m-1a`）也带序号：字母后缀是代际标记 ⇒ `m1` / `1` 仍指得到同一张卡
  const m = /^(?:m-?)?(\d+)(?:[a-z])?$/.exec(String(v ?? "").trim());
  return m ? Number(m[1]) : null;
}

/**
 * 目标是否一致。
 *
 * 规则：逐字相等 ⇒ 一致；否则里程碑按**序号**归一（`m3` / `3` / `m-3` 都算同一点名）——
 *   但**两侧都带代际字母且不同**（`m-1a` vs `m-2a`）⇒ 不一致（那确实是两张卡）。
 *   一侧带字母一侧不带（`m1` vs `m-1a`）⇒ 按序号判：confirm 只听「是不是这张」，不需要消歧。
 */
export function sameTarget(got, want) {
  const g = String(got ?? "").trim();
  const w = String(want ?? "").trim();
  if (!g || !w) return false;
  if (g === w) return true;
  const hasSeries = (v) => /[a-z]/i.test(v.replace(/^m-?/i, ""));
  if (hasSeries(g) && hasSeries(w)) return false;
  const gn = milestoneNoOf(g);
  const wn = milestoneNoOf(w);
  return gn !== null && wn !== null && gn === wn;
}

/** 是否已点名确认（裸 `--confirm` 不算） */
export function isConfirmed(args, expected) {
  const got = args?.confirm;
  if (got === true) return false;
  return sameTarget(got, expected);
}

/** 统一报错文案（各命令共用一份措辞） */
export function confirmHint(cmd, expected) {
  return [
    `${cmd} 是高危动作（结版 / 退档 / 折叠会改账面向外宣告），必须点名确认：--confirm ${expected}`,
    "口径见 entry/workflow/protocol.md §3.6 第 4 条（结版须用户确认 · 铁律）",
  ].join("\n  · ");
}

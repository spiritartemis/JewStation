/**
 * 发版账的**计划实现**（两轴模型 · 发布轴）—— `gd release new|list|show|add|freeze|tag`
 *
 * 发布轴的写面：版本号在这里产生、需求在这里收进版本、冻结与打 tag 在这里宣告。
 * 里程碑（开发线）不再带版号——**版本坐标只在这里出现**。
 *
 * 三态（人的宣告，逐级推进）：`draft`（在挑需求）→ `frozen`（成员锁定，冻结前须带回归证据）→ `tagged`（已打 tag）。
 * 成员是**多对多**：同一需求可出现在多条 release 里（backport）⇒ 成员按 (版本, 需求 id) 对记。
 */
import { dateStrOf } from "./milestones.mjs";
import { readReqEntries, withBoardLock } from "./board.mjs";
import { findRelease, isReleaseVersion, nextReleaseVersion, readReleases, releasesView, validateReleases, writeReleases } from "./releases.mjs";
import { out } from "./style.mjs";

/** 版本号 → 建议 tag 名：`0.70` ⇒ `v0.70.0`；`0.70.6` ⇒ `v0.70.6`（已是三段就别再补） */
const tagOf = (ver) => `v${String(ver ?? "").split(".").length >= 3 ? ver : `${ver}.0`}`;

const ok = (lines, extra = {}) => ({ ok: true, lines, ...extra });
const bad = (lines) => ({ ok: false, code: 1, lines });
const asJson = (obj) => ({ ok: true, lines: [], json: obj });

/** 开一条对外版本（`draft`） */
export function releaseNewPlan({ board, name = "", version = "", note = "", json = false }) {
  return withBoardLock(board.root, () => {
    const fresh = readReleases(board.root);
    if (!fresh.ok) return bad([`✗ 发版账读取失败：${fresh.error}`]);
    const ver = String(version ?? "").trim() || nextReleaseVersion(fresh.list);
    if (!isReleaseVersion(ver)) return bad([`✗ 版本号形态非法：${ver}（应为 x.y 或 x.y.z，如 0.70.6）`]);
    if (findRelease(fresh.list, ver)) return bad([`✗ 版本 ${ver} 已在发版账里（不重号）`]);
    const entry = { version: ver, status: "draft", reqs: [], tag: "", evidence: "", note: String(note ?? "").trim(), created: dateStrOf() };
    const next = [...fresh.list, entry];
    const errs = validateReleases(next);
    if (errs.length > 0) return bad([`✗ 写入校验未通过：${errs.map((e) => e.msg).join(" / ")}`]);
    writeReleases(board.root, next);
    if (json) return asJson({ ok: true, board: board.id, release: entry });
    return ok([
      out.ok(`✅ 已开对外版本 ${ver}（draft）${name ? ` · ${name}` : ""}`),
      out.dim("  · 收需求：gd release add " + ver + " --req <需求id>"),
      out.dim("  · 冻结（成员锁定）→ 打 tag：gd release freeze " + ver + " --evidence \"…\" → gd release tag " + ver + " --tag " + tagOf(ver)),
    ]);
  });
}

/** 发版账清单（只读） */
export function releaseListPlan({ board, json = false }) {
  const fresh = readReleases(board.root);
  if (!fresh.ok) return bad([`✗ 发版账读取失败：${fresh.error}`]);
  const view = releasesView(fresh.list);
  if (json) return asJson({ ok: true, board: board.id, releases: view.items, summary: view.summary });
  if (view.items.length === 0) return ok([out.dim("（发版账还是空的——gd release new \"<名称>\"）")]);
  return ok([
    ...view.items.map((r) => `${r.status === "tagged" ? out.ok("✅") : r.status === "frozen" ? "▸" : "·"} ${r.version}  ${r.status}${r.tag ? `  ${r.tag}` : ""}  需求 ${r.reqs_total ?? r.reqs.length}${r.note ? `  ${out.dim(r.note)}` : ""}`),
    out.dim(`共 ${view.summary.total} 条：draft ${view.summary.draft} · frozen ${view.summary.frozen} · tagged ${view.summary.tagged}`),
  ]);
}

/** 单条 release 详情（只读） */
export function releaseShowPlan({ board, version, json = false }) {
  const ver = String(version ?? "").trim();
  const fresh = readReleases(board.root);
  if (!fresh.ok) return bad([`✗ 发版账读取失败：${fresh.error}`]);
  const rec = findRelease(fresh.list, ver);
  if (!rec) return bad([`✗ 版本 ${ver} 不在发版账里（gd release list 看现有）`]);
  if (json) return asJson({ ok: true, board: board.id, release: rec });
  return ok([
    `${out.ok("▸")} ${rec.version}  ${rec.status}${rec.tag ? `  ${rec.tag}` : ""}${rec.created ? `  （建于 ${rec.created}）` : ""}`,
    ...(rec.reqs.length > 0 ? [`  需求：${rec.reqs.join(" / ")}`] : [out.dim("  需求：（还没收）")]),
    ...(rec.evidence ? [`  证据：${rec.evidence}`] : []),
    ...(rec.note ? [out.dim(`  ${rec.note}`)] : []),
  ]);
}

/** 往版本里收需求（draft 才能改；已冻结/已打 tag ⇒ 拒） */
export function releaseAddPlan({ board, version, reqs = [], json = false }) {
  const ver = String(version ?? "").trim();
  const want = (Array.isArray(reqs) ? reqs : [reqs]).map((x) => String(x ?? "").trim()).filter(Boolean);
  if (want.length === 0) return bad(["✗ 缺需求 id（gd release add <版本> --req <需求id>）"]);
  return withBoardLock(board.root, () => {
    const fresh = readReleases(board.root);
    if (!fresh.ok) return bad([`✗ 发版账读取失败：${fresh.error}`]);
    const rec = findRelease(fresh.list, ver);
    if (!rec) return bad([`✗ 版本 ${ver} 不在发版账里（gd release new 先开一条）`]);
    if (rec.status !== "draft") return bad([`✗ 版本 ${ver} 已 ${rec.status}（成员锁定）——要改先开新版本或改需求本身`]);
    const known = new Set(readReqEntries(board.root).map((r) => String(r?.id ?? "")));
    const missing = want.filter((x) => !known.has(x));
    if (missing.length > 0) return bad([`✗ 需求不存在：${missing.join(" / ")}`]);
    const merged = [...new Set([...rec.reqs, ...want])];
    const next = fresh.list.map((r) => (r.version === ver ? { ...r, reqs: merged } : r));
    const errs = validateReleases(next);
    if (errs.length > 0) return bad([`✗ 写入校验未通过：${errs.map((e) => e.msg).join(" / ")}`]);
    writeReleases(board.root, next);
    if (json) return asJson({ ok: true, board: board.id, version: ver, reqs: merged, added: want.filter((x) => !rec.reqs.includes(x)) });
    const added = want.filter((x) => !rec.reqs.includes(x));
    return ok([
      out.ok(`✅ 版本 ${ver} 收了 ${want.length} 条需求${added.length < want.length ? `（${want.length - added.length} 条已在册）` : ""}`),
      out.dim(`  · 当前成员 ${merged.length} 条：${merged.join(" / ") || "（空）"}`),
    ]);
  });
}

/** 冻结版本（成员锁定；须带回归证据） */
export function releaseFreezePlan({ board, version, evidence = "", json = false }) {
  const ver = String(version ?? "").trim();
  const ev = String(evidence ?? "").trim();
  if (!ev) return bad(["✗ 冻结须带回归证据（--evidence \"…\"）"]);
  return withBoardLock(board.root, () => {
    const fresh = readReleases(board.root);
    if (!fresh.ok) return bad([`✗ 发版账读取失败：${fresh.error}`]);
    const rec = findRelease(fresh.list, ver);
    if (!rec) return bad([`✗ 版本 ${ver} 不在发版账里`]);
    if (rec.status !== "draft") return bad([`✗ 版本 ${ver} 已是 ${rec.status}（冻结只做一次）`]);
    const next = fresh.list.map((r) => (r.version === ver ? { ...r, status: "frozen", evidence: ev, frozen_on: dateStrOf() } : r));
    const errs = validateReleases(next);
    if (errs.length > 0) return bad([`✗ 写入校验未通过：${errs.map((e) => e.msg).join(" / ")}`]);
    writeReleases(board.root, next);
    if (json) return asJson({ ok: true, board: board.id, version: ver, status: "frozen" });
    return ok([
      out.ok(`✅ 版本 ${ver} 已冻结（成员 ${rec.reqs.length} 条锁定）`),
      out.dim("  · 下一步：gd release tag " + ver + " --tag " + tagOf(ver)),
    ]);
  });
}

/** 打 tag（frozen → tagged；tag 名必填） */
export function releaseTagPlan({ board, version, tag = "", json = false }) {
  const ver = String(version ?? "").trim();
  const t = String(tag ?? "").trim();
  if (!t) return bad(["✗ 缺 tag 名（gd release tag <版本> --tag v0.70.0）"]);
  return withBoardLock(board.root, () => {
    const fresh = readReleases(board.root);
    if (!fresh.ok) return bad([`✗ 发版账读取失败：${fresh.error}`]);
    const rec = findRelease(fresh.list, ver);
    if (!rec) return bad([`✗ 版本 ${ver} 不在发版账里`]);
    if (rec.status !== "frozen") return bad([`✗ 版本 ${ver} 还没冻结（先 gd release freeze ${ver} --evidence \"…\"）`]);
    const next = fresh.list.map((r) => (r.version === ver ? { ...r, status: "tagged", tag: t, tagged_on: dateStrOf() } : r));
    const errs = validateReleases(next);
    if (errs.length > 0) return bad([`✗ 写入校验未通过：${errs.map((e) => e.msg).join(" / ")}`]);
    writeReleases(board.root, next);
    if (json) return asJson({ ok: true, board: board.id, version: ver, status: "tagged", tag: t });
    return ok([out.ok(`✅ 版本 ${ver} 已打 tag ${t}`)]);
  });
}

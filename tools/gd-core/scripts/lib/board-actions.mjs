/**
 * 板经营动作 · 流转（board actions）—— **core 层**的「交件 / 验收」实现（0.23.0 R-gm-047）
 *
 * 两条日常命令在板模式下的**完整流程**（参数取义 → 落点 → 状态推导 → 写账 + 事件 → 人读回显）只写一份：
 *   · core 面：`gd-core handoff <任务id>` / `gd-core check <任务id> --pass|--reject`
 *   · 完整 CLI：同两条命令的板分支（注册项目账 / 收权闸门属 app 侧，仍归原文件）
 *
 * 与 `board-plans.mjs` 同形态：返回 `{ ok, lines, ... }`，不决定退出码、不吞输出（core 与完整 CLI 回显一致）。
 *
 * 口径（与 0.16.8 收权前的 owner 面完全同源，未放宽）：
 *   · handoff 四要素 `done / remain / decision / next`；`--status` 只收 `in_progress` / `review`——
 *     **不能把任务推入 `done`**（进终态必带验收结论，只走 check）；
 *   · 交接完成（有 done 无 remain）→ `review`（进验收窗口），同时放占用；
 *   · check `--pass` 只对 `review` 生效 → `done` + 任务账 `review` 段；`--reject` 对 `review` / `done` → 回 `in_progress`。
 *
 * 依赖方向（本文件 = core）：board-context / board-ledger / artifacts / style，**零 app import**。
 */
import { locateBoardTask } from "./board-context.mjs";
import { applyTransition, checkTraceAttach, currentArtifactsOf } from "./board-ledger.mjs";
import { artifactOf, checksumOfPath } from "./artifacts.mjs";
import { checksumOfPathAt, commitsTouching, dirtyPaths, headOf, isGitRepo, typeAt } from "./artifact-git.mjs";
import { ARTIFACT_ERRORS, collideLines, normPath } from "./artifact-conflict.mjs"; // 0.70.5 R-gm-70-5：冲突拒单码 + 行化 + 路径归一（判据本身在 board-ledger 锁内）
import { nowIso } from "./board.mjs"; // 0.33.1：trace 关联的登记时间
import { readTaskLedger, reqStatusOfLedger } from "./board.mjs"; // 0.49.6（F2）：派生态回显不能靠「有没有变化」猜
import { join } from "node:path";
import { existsSync } from "node:fs";
import { claimBlockHints, claimOf, describeClaim, isClaimExpired, sessionIdFromEnv } from "./workclaim.mjs"; // 0.24.2 R-gm-087：占用闸门（core 层租约判据）· B-gm-000061：出路与 claim 同源
import { out, errOut } from "./style.mjs";
import { spawnSync } from "node:child_process";

/**
 * 交付件条目：优先取**落地提交里的内容**（0.70.6 · B-gm-000060）。
 *
 * 为什么指纹不取工作树字节：工作树会被后续任务合法改动（改同文件 / 删文件），
 *   拿它当事实源 ⇒「后续任务合法改动」与「成果被回退」判成同一件事。
 *   取提交内容则：成果在不在，看提交就知；后续改动动不了既成事实。
 * 取不到（无提交 / 非 git 仓 / 该件没进那个提交）⇒ 退回工作树视图，并在账上标明 source。
 * @param {string} basis 交付件基准（代码仓根）
 * @param {string} rel 仓内相对路径
 * @param {string|null} base 落地 / 提交提交号（可为 null）
 */
function artifactAt(basis, rel, base) {
  const norm = String(rel).split("\\").join("/");
  if (base && isGitRepo(basis)) {
    const type = typeAt(basis, base, norm);
    if (type === "blob" || type === "tree") {
      const kind = type === "tree" ? "package" : "file";
      const checksum = checksumOfPathAt(basis, base, norm, kind);
      // source_commit 逐件记下「这个指纹是从哪个提交算的」——任务的 landed.head 不稳
      //   （同工作单元里再 land 一次会把它刷成新头），逐件记才能定位「我交的是哪一版」。
      if (checksum) return { path: norm, kind, checksum, at: nowIso(), source: "commit", source_commit: base };
    }
  }
  return artifactOf(basis, rel);
}

/**
 * 任务的「事实源提交」：落地提交优先，其次提交提交。
 * @param {object|null} task 任务账条目
 * @returns {string|null} 提交号（读不到返回 null）
 */
function commitBaseOf(task) {
  const pick = (v) => {
    if (!v) return null;
    if (typeof v === "object") {
      const head = v.head ?? v.commit ?? null;
      return typeof head === "string" && head.trim() ? head.trim() : null;
    }
    if (typeof v === "string") {
      const s = v.trim();
      if (/^[0-9a-f]{7,40}$/i.test(s)) return s; // 直接就是提交号
      // 账里的 `landed` / `submitted` 是**对象** ⇒ 本仓 yaml 子集不认非空 flow mapping
      //   ⇒ parseYaml 读回来是一串 JSON 文本（序列化时也是这么写的）。这里把它解开。
      if (s.startsWith("{")) {
        try {
          const o = JSON.parse(s);
          const head = o?.head ?? o?.commit ?? null;
          return typeof head === "string" && head.trim() ? head.trim() : null;
        } catch {
          return null;
        }
      }
    }
    return null;
  };
  return pick(task?.landed) ?? pick(task?.submitted);
}

/**
 * 当前分支（core 层最小实现）。
 *
 * 为什么不 import `lib/git.mjs`：那个文件依赖 `registry.mjs`（app 层），而本文件的口径是**零 app import**。
 * 这里只要「cwd 在哪个分支」这一条观测，不需要 git 封装的其余能力——宁可三行本地实现，不破分层。
 * 失败（不是仓 / 无 git）一律返回 ""，由调用方把「读不到」当作「不判」，绝不因为读不到就拒。
 */
function branchOfCwd() {
  try {
    const r = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: process.cwd(), encoding: "utf8" });
    if (r.status !== 0) return "";
    const b = String(r.stdout ?? "").trim();
    return b === "HEAD" ? "" : b; // detached HEAD 无分支名，同样不判
  } catch {
    return "";
  }
}

/** handoff 只驱动这两档：`in_progress` 认领 / 返工，`review` 交件（`done` 归 check） */
export const HANDOFF_STATUSES = ["in_progress", "review"];

/**
 * 工作单元的工作区路径（账上 `work_units[].path`）——只给报错文案用。
 *
 * 为什么要读账：分支闸门拒单时要告诉人「cd 到哪儿」，而这个路径只有账上有；
 *   猜路径（`<repo>.wt/<需求id>`）在 `--worktree-dir` 自定义时就是错的。
 * 读不到（账缺 / 解析失败 / 单元不在册）一律返回 null，由调用方退回落文案——不因为读不到就拒。
 */
function workUnitPathOf(loc, unit) {
  try {
    const ledger = readTaskLedger(loc.projDir, loc.reqId);
    const units = Array.isArray(ledger.workUnits) ? ledger.workUnits : [];
    const hit = units.find((u) => String(u?.id ?? "") === unit || String(u?.branch ?? "") === unit);
    const path = String(hit?.path ?? "").trim();
    return path || null;
  } catch {
    return null;
  }
}

/**
 * 需求**当前**派生态（0.49.6 F2）——只给回显用。
 *
 * 为什么需要它：`refreshReqStatuses` 只返回**变了**的需求（省写盘），没变化时数组是空的；
 *   把它直接渲染成 `—` 会读成「未知 / 没有派生态」。派生态是账的事实，不是「本次变化」。
 * 读不到账就回 `未知`：回显不编状态，也不阻断主流程（真问题归 `gd contract check`）。
 */
function deriveCurrentReqStatus(loc) {
  try {
    const ledger = readTaskLedger(loc.projDir, loc.reqId);
    return ledger.missing ? "未知" : reqStatusOfLedger(ledger);
  } catch {
    return "未知";
  }
}

const err = (line) => line;

/**
 * 状态推导：显式 `--status` 优先；**交件完成（有 done 无 remain）→ review**；纯留痕（还没干完）→ in_progress。
 *
 * 0.24.2 R-gm-087（旧口径已废）：旧版是「首次接手 ⇒ in_progress，交件完成 ⇒ review（但要求当前已是 in_progress）」，
 *   于是新任务跑 `gd handoff --done` 只到 in_progress，而 done / 交付件 / 事件**照样入账** ⇒
 *   **交件内容与交件状态脱节**，验收方（`gd task list --to-check` 只列 review）蹲不到单子，易误判「没交件」。
 *   现口径：有 done 无 remain = 交完了 ⇒ 直接进验收窗口（合法流转表已加 `ready → review` 的交件合一跃迁）。
 */
export function handoffTarget(current, done, remain, claiming) {
  if (done.length > 0 && remain.length === 0) return "review";
  if (claiming) return "in_progress"; // 纯留痕（还在干 / 无 done）
  return null;
}

/** 定位失败统一成 plan（core 与完整 CLI 共用同一组错误行） */
function locatePlan(loc) {
  if (loc.ok) return null;
  return { ok: false, code: 1, lines: [errOut.err(`✗ ${loc.error}`), ...(loc.hint ?? []).map((h) => `  · ${h}`)] };
}

/**
 * 决策 trace 关联闸门的**回显层**（判据在 `board-ledger.checkTraceAttach`，三条交件路径共用）。
 * @param {object} loc `locateBoardTask` 结果
 * @param {string} taskId
 * @param {string[]} traceIds 已去重
 * @returns {object|null} 非 null = 拒（plan 形态）
 */
function tracePlan(loc, taskId, traceIds) {
  const r = checkTraceAttach({ projDir: loc.projDir, reqId: loc.reqId, taskId, traceIds });
  if (r.ok) return null;
  return { ok: false, code: 1, lines: [errOut.err(`✗ ${r.error}`), ...r.hint.map((h) => `  · ${h}`)] };
}

/**
 * `handoff`（交件 / 进展）—— 板模式单实现
 * @param {{taskId: string, reqId?: string|null, done?: string[], remain?: string[], decision?: string|null,
 *          next?: string|null, text?: string|null, status?: string|null, artifacts?: string[], traces?: string[],
 *          json?: boolean}} p
 */
export function handoffOnBoard(p) {
  const done = p.done ?? [];
  const remain = p.remain ?? [];
  const loc = locateBoardTask(p.taskId, { reqId: p.reqId ?? null });
  const bad = locatePlan(loc);
  if (bad) return bad;
  // 0.24.2 R-gm-087：交件内容必填（与席位面同口径）——「纯接手/认领」是 `gd work claim` 的活（有租约、可被接管）。
  if (!done.length && !remain.length) {
    return {
      ok: false,
      code: 1,
      lines: [errOut.err(`✗ handoff 至少给一个 --done "已做" 或 --remain "未做"（纯接手/认领走 gd work claim）`)],
    };
  }
  // 0.24.2 R-gm-087：未派任务（executor 空 = 没有承接方）不可交件。
  if (!String(loc.task.executor ?? "").trim()) {
    return {
      ok: false,
      code: 1,
      lines: [
        errOut.err(`✗ 不可交件：${p.taskId} 未派（executor 空 = 没有承接方）——先定承接方（板面：拆任务时带承接方前缀，如 local:标题；席位面：gd seat task dispatch）`),
      ],
    };
  }
  // 0.24.2 R-gm-087：占用闸门——他人持有且租约未过期 ⇒ 拒（--force 接管并留痕）。
  const held = claimOf(loc.task);
  const forced = p.force === true;
  if (held && !isClaimExpired(held)) {
    const holder = String(held.session ?? "");
    const session = sessionIdFromEnv();
    const mine = holder && holder === session;
    if (!mine && !forced) {
      return {
        ok: false,
        code: 1,
        lines: [
          errOut.err(`✗ 不可交件：${p.taskId} 正被占用（${describeClaim(held)}）`), // 会话名在 describeClaim 里，别再前缀一遍（B-gm-000061 顺带修的重复渲染）
          // B-gm-000061：出路与 `gd work claim` 的 E_CLAIMED 用同一份措辞（自己撞自己时先教会话号）
          ...claimBlockHints({ taskId: p.taskId, holder, session }).map((l) => `  · ${l}`),
          `  · 确需接管：加 --force（留痕）`,
        ],
      };
    }
  }
  const artifacts = [];
  const basis = loc.artifactRoot ?? loc.projDir; // 基准是代码仓（artifactBasis）
  const base = commitBaseOf(loc.task);
  for (const rel of p.artifacts ?? []) {
    // 指纹优先取**落地提交里的内容**（权威事实源）；没有提交可依时退回工作树视图（source 标出来）
    const art = artifactAt(basis, rel, base);
    if (!art) return { ok: false, code: 1, lines: [errOut.err(`✗ 交付件不存在（相对项目根）：${rel}`)] };
    artifacts.push(art);
  }
  // 0.33.1 R-gm-33-1-01：决策 trace 关联（交件时登记「这份活依据了哪条建议」，验收时据此回填标签）
  const traceIds = [];
  for (const raw of p.traces ?? []) {
    const id = String(raw ?? "").trim();
    if (id && !traceIds.includes(id)) traceIds.push(id);
  }
  if (traceIds.length > 0) {
    const bad = tracePlan(loc, p.taskId, traceIds);
    if (bad) return bad;
  }
  const claiming = loc.task.status === "ready";
  const to = p.status ?? handoffTarget(loc.task.status, done, remain, claiming);

  // ⓪ 工作单元闸门（0.47 · B-gm-000022 / T-gm-B000022-01）——交件之前，先确认「这活是在隔离工作区里干的」
  //   为什么落在 handoff：它是任务进入 review（= 声称「做完了」）的唯一入口，而且 core / 完整 CLI 共用本函数。
  //     放在 check 就晚了（check 之前任务必须已在 review，而 review 只能由 handoff 产生）；
  //     放在 claim 太早（认领时还没开工，且认领不该有副作用——拦不住的检查别白占租约）。
  //   为什么不用 --force：它已用于认领抢占，一个旗标两种后果会让「越过工作区闸门」变成「顺手抢了别人的租约」。
  //     越过方式是独立的 `--direct`（明确表态「这次不隔离」），并落事件留痕。
  //   判据：交件（to === review）时 ① task.work_unit 必须存在（gd work start 写的）；
  //     ② cwd 的分支必须等于该工作单元的分支。读不到分支（非仓 / detached）不判，只按 ① 判。
  if (to === "review") {
    const unit = String(loc.task.work_unit ?? "").trim();
    const direct = p.direct === true;
    if (!unit && !direct) {
      return {
        ok: false,
        code: 1,
        lines: [
          errOut.err(`✗ 不可交件：${p.taskId} 没有工作单元（task.work_unit 空 = 从没开过隔离工作区）`),
          `  · 开工作区：gd work start ${p.taskId}（分支 req/${loc.reqId}），在那里改代码，回来再交件`,
          `  · 确需直改主干：加 --direct（落事件留痕，说明为什么这次不隔离）`,
        ],
      };
    }
    const br = unit && !direct ? branchOfCwd() : "";
    if (br && br !== unit) {
      // B-gm-000057：报错里的「cd 到工作区」必须是**能跑通**的——`land` 默认回收工作区 + 删分支，
      //   此时人回主仓交件，原来那句指引指向一个已被删掉的目录（判据：指引必须可执行）。
      //   出路按「工作区还在不在」分岔：在 ⇒ 给绝对路径；不在 ⇒ 给 `gd work start` 原地重开。
      const unitPath = workUnitPathOf(loc, unit);
      const gone = unitPath ? !existsSync(unitPath) : false;
      const lines = [errOut.err(`✗ 不可交件：当前在分支 ${br}，但 ${p.taskId} 的工作单元是 ${unit}`)];
      if (gone) {
        lines.push(`  · 工作区已被 land 回收（${unitPath}）——原地重开：gd work start ${p.taskId}`);
        lines.push(`    然后 cd 进去交件；回收是 land 的默认行为，下次合入用 gd work land ${p.taskId} --keep`);
      } else if (unitPath) {
        lines.push(`  · cd 到工作区再交件：${unitPath}（gd work list 可查目录）`);
      } else {
        lines.push(`  · cd 到工作区再交件（gd work list 可查目录）`);
      }
      lines.push(`  · 确需在别的分支交件：加 --direct（落事件留痕）`);
      return { ok: false, code: 1, lines };
    }
  }

  const actor = String(loc.task.executor ?? "") || "local"; // core 无引导：actor 取任务负责人
  // 留痕一次合成：两个开关都要写 text，逐个 spread 会互相覆盖（后者吃掉前者）
  const gateNotes = [];
  if (forced && held && !isClaimExpired(held)) gateNotes.push(`--force 接管占用（原持有者 ${held.session ?? "?"}）`);
  if (p.direct === true && to === "review") gateNotes.push("--direct 越过工作单元闸门（未隔离）");
  const handoffText = [p.text, ...gateNotes].filter(Boolean).join(" · ");
  const handoff = {
    ...(done.length ? { done } : {}),
    ...(remain.length ? { remain } : {}),
    ...(p.decision ? { decision: p.decision } : {}),
    ...(p.next ? { next: p.next } : {}),
    ...(handoffText ? { text: handoffText } : {}),
  };
  let result;
  try {
    result = applyTransition({
      projDir: loc.projDir,
      reqId: loc.reqId,
      taskId: p.taskId,
      to,
      allowSame: true,
      clearClaim: to === "review" || forced, // 交付进验收窗口即放占用（0.21.6）；--force 接管也放掉旧占用
      artifacts: artifacts.length ? artifacts : null,
      traces: traceIds.length ? traceIds.map((id) => ({ id, at: nowIso(), by: actor })) : null,
      // 0.24.2 R-gm-087：事件 kind 统一为 handoff（「认领」专指 gd work claim 的真认领，不再同名不同物）
      event: { actor, kind: "handoff", state: `${loc.task.status} → ${to ?? loc.task.status}`, ...handoff },
      // 0.70.5：`deliver` 事件由 `applyTransition` 生成（只有它知道判重后真正进了几件）——
      //   本处只给「谁交的 / 交件说明」，不再自己拼 `N 件`（拼了必然在判重时多报）。
      deliver: artifacts.length ? { actor, text: p.text ?? "" } : null,
    });
  } catch (e) {
    // 同名件冲突是**结构化**拒单（`code` + `conflicts`）：逐行回显，别糊成一句「交接失败」
    if (e?.code === ARTIFACT_ERRORS.COLLIDE) {
      const [head, ...rest] = collideLines(e);
      return { ok: false, code: 1, lines: [errOut.err(`✗ ${head}`), ...rest] };
    }
    return { ok: false, code: 1, lines: [errOut.err(`✗ 交接失败：${e.message}`)] };
  }
  const kind = "handoff";
  // 0.70.5 R-gm-70-5 T-03：判重必须出声——静默去重等于让人以为交了 5 件、实际只进 3 件。
  const deduped = Array.isArray(result.artifacts_deduped) ? result.artifacts_deduped : [];
  const dedupedPaths = new Set(deduped.map((d) => String(d.path)));
  const entered = artifacts.filter((a) => !dedupedPaths.has(normPath(a.path)));
  if (p.json) return { ok: true, code: 0, lines: [JSON.stringify({ ok: true, task: p.taskId, req: loc.reqId, from: result.from, to: result.to, kind, artifacts: entered.length, deduped, traces: traceIds, events: result.events, derived: result.derived }, null, 2)] };
  const lines = [
    out.ok(`✅ 已交件：${p.taskId}（${loc.task.title ?? ""}）`),
    `  状态：${result.from} → ${result.to} · 事件 kind=${kind} seq ${result.events[0]?.seq}`,
  ];
  if (done.length || remain.length || p.decision || p.next) {
    lines.push(`  交接四要素：done ${done.length} · remain ${remain.length} · decision ${p.decision ? "有" : "无"} · next ${p.next ?? "—"}`);
  }
  for (const a of entered) lines.push(`  交付件：${a.path}（${a.kind} · ${a.checksum} · ${a.source === "commit" ? "取自落地提交" : "工作树视图"}）`);
  for (const d of deduped) lines.push(out.dim(`  ↺ 判重跳过：${d.path}（同路径同指纹 ${d.checksum}，账上已有，不重复入账）`));
  for (const id of traceIds) lines.push(`  决策 trace：${id}（验收时按它回填后验标签）`);
  if (result.to === "review") lines.push("  ℹ 已进入验收窗口：gd check <任务id> --pass | --reject \"原因\"");
  lines.push(out.dim("  账在板上（.git/gdtwork）：无需提交；视图可用 gd core roadmap --write 重算"));
  return { ok: true, code: 0, lines, data: { from: result.from, to: result.to, kind, req: loc.reqId, deduped: deduped.length } };
}

/**
 * `check`（验收 / 打回）—— 板模式单实现
 * @param {{taskId: string, reqId?: string|null, pass?: boolean, reject?: string|null, by?: string|null,
 *          note?: string|null, json?: boolean, nowIso: string, force?: boolean, decisionOverridden?: boolean}} p
 */
export function checkOnBoard(p) {
  const loc = locateBoardTask(p.taskId, { reqId: p.reqId ?? null });
  const bad = locatePlan(loc);
  if (bad) return bad;
  const task = loc.task;
  // 通过只对 review；打回对 review / done（验收后返工重开）
  if (p.pass && task.status !== "review") {
    return { ok: false, code: 1, lines: [errOut.err(`✗ 不可验收：${p.taskId} 当前 ${task.status}（通过只对 review 态生效；交付方先 gd handoff 交件）`)] };
  }
  if (!p.pass && !["review", "done"].includes(task.status)) {
    return { ok: false, code: 1, lines: [errOut.err(`✗ 不可打回：${p.taskId} 当前 ${task.status}（打回只对 review / done 生效）`)] };
  }
  const by = p.by || String(task.executor ?? "") || "local"; // 板模式缺省 = 任务负责人（板主人自验）
  const at = p.nowIso;
  const note = p.note ?? null;

  // B-gm-000004：验收前复算「当前有效」交付件指纹。
  //   背景：artifacts 段曾只追加不失效——同一文件被后续任务改动后，原任务账上的旧指纹永远对不上，
  //   而 `--pass` 完全不看件，于是「账说 sha256:A、代码是 B」也能过验收，审计无从分辨。
  // 0.70.6 改判据（B-gm-000060）：事实源从「当前工作树字节」换成「**落地提交里那份内容**」。
  //   为什么换：工作树会被后续任务合法改动（改同一个文件 / 删掉它），
  //     拿它当事实源 ⇒「后续任务合法改动」与「成果被回退」被判成同一件事
  //     （本仓 3 次触发全是假阳性、0 次真阳性）。
  //   三问（顺序即优先级）：
  //     ① 成果还在吗：落地提交里该件内容 vs 账上指纹 ⇒ 对得上就是成果仍在
  //     ② 后续谁碰过：落地提交之后哪些提交改过它 ⇒ **只提示，不拦**（成果仍在就是成果仍在）
  //     ③ 工作树干不干净：未提交的改动**不会**被 land 带走，与已交付内容无关 ⇒ 只提示，不拦
  //   判定程序（任一成立即「成果仍在」）：
  //     · 落地提交里该件内容 == 账上指纹   （交过且已入提交——最常见）
  //     · 当前工作树字节 == 账上指纹       （没入提交但也没人动过）
  //     · 有后续提交改过它                （后续任务合法改动 / 删除）
  //   三条都不成立 ⇒ **真失配**（账实不符且无解释）⇒ 拦。
  //   落地提交读不到（非 git 仓 / 无 landed 记录）⇒ 自动退回「比工作树字节」的旧口径。
  const stale = [];
  const hints = [];
  if (p.pass) {
    const basis = loc.artifactRoot ?? loc.projDir;
    const taskBase = commitBaseOf(task);
    const isGit = isGitRepo(basis);
    const head = isGit ? headOf(basis) : null;
    const paths = [];
    for (const a of currentArtifactsOf(task)) {
      if (!a.checksum) continue; // 存量条目无指纹：无从校验，跳过（不报假警）
      paths.push(a.path);
      // **逐件**取事实源提交：件自己记的 source_commit（我交的是哪一版）优先；
      //   没有就退回任务的落地头（老账）。不能用任务级头当唯一事实源——
      //   同工作单元里再 land 一次会把它刷成新头（原任务因此误判失配，实测踩过）。
      const base = a.source_commit ?? taskBase;
      const atCommit = base && isGit ? checksumOfPathAt(basis, base, a.path, a.kind ?? null) : null;
      const atWorktree = checksumOfPath(join(basis, a.path));
      if (atCommit !== null && atCommit === a.checksum) {
        // ① 成果仍在（按落地提交）——后续谁碰过它，只提示
        if (head) {
          const later = commitsTouching(basis, base, head, a.path);
          if (later && later.length) {
            hints.push(`${a.path}：后续提交 ${later.map((c) => `${c.sha} ${c.subject}`).join("；")} 改过它 —— 成果仍在（按落地提交核），放行`);
          }
          if (typeAt(basis, head, a.path) === null) {
            hints.push(`${a.path}：已被后续提交删除 —— 交付时它在、现在不在，不判失配`);
          }
        }
        continue;
      }
      if (atWorktree === a.checksum) continue; // ② 工作树还是交付时那份
      // ③ 后续提交碰过它吗？碰过 ⇒ 后续任务合法改动，放行（只提示）
      const later = head && base ? commitsTouching(basis, base, head, a.path) : null;
      if (later && later.length) {
        hints.push(`${a.path}：后续提交 ${later.map((c) => `${c.sha} ${c.subject}`).join("；")} 改过它 —— 成果仍在，放行`);
        continue;
      }
      stale.push({
        path: a.path,
        recorded: a.checksum,
        current: atCommit ?? atWorktree,
        why: atCommit === null ? "落地提交读不到，按当前工作树核也对不上" : "落地提交里该件内容与账上指纹不符，且没有后续提交能解释",
      });
    }
    // 工作树有没有未提交改动（只提示，不拦）
    const dirty = dirtyPaths(basis, paths);
    if (dirty && dirty.length) {
      hints.push(`工作树有未提交改动（${dirty.join("；")}）—— 未提交的改动不会被 land 带走，与已交付内容无关，不影响验收`);
    }
    if (stale.length > 0 && p.force !== true) {
      return {
        ok: false,
        code: 1,
        lines: [
          errOut.err(`✗ 不可验收：${p.taskId} 的交付件与账不符（E_ARTIFACT_STALE · ${stale.length} 件）`),
          ...stale.map((s) => `  · ${s.path}：账上 ${s.recorded} · ${s.current === null ? "当前（文件已不存在）" : `当前 ${s.current}`}${s.why ? ` —— ${s.why}` : ""}`),
          "  这是真失配（账实不符且无解释），两条收口：",
          "    ① 恢复成果：把该件改回交付时的内容并提交，再验收",
          `    ② 确认改动无害：gd check ${p.taskId} --pass --force（覆盖项记进 review.artifact_override）`,
        ],
      };
    }
  }
  const override = stale.length > 0 ? stale : null;
  // 0.33.1：验收人声明「业务最终走了别的路」——只影响后验标签（overridden），**不影响验收结论**
  const decisionOverridden = p.decisionOverridden === true;

  const review = p.pass
    ? { verdict: "pass", by, at, ...(note ? { note } : {}), ...(override ? { artifact_override: override } : {}), ...(decisionOverridden ? { decision_overridden: true } : {}) }
    : { verdict: "reject", by, at, note: p.reject };
  let result;
  try {
    result = applyTransition({
      projDir: loc.projDir,
      reqId: loc.reqId,
      taskId: p.taskId,
      to: p.pass ? "done" : "in_progress",
      clearClaim: true, // 验收收尾即放占用（0.21.6；打回后由执行方重新认领）
      review,
      event: { actor: by, kind: "review", state: p.pass ? "pass" : "reject", verdict: review.verdict, ...(note || p.reject ? { text: p.pass ? note : p.reject } : {}) },
    });
  } catch (e) {
    return { ok: false, code: 1, lines: [errOut.err(`✗ 验收失败：${e.message}`)] };
  }
  if (p.json) return { ok: true, code: 0, lines: [JSON.stringify({ ok: true, task: p.taskId, req: loc.reqId, verdict: review.verdict, by, from: result.from, to: result.to, review, labels: result.labels ?? [], label_error: result.label_error ?? null, derived: result.derived }, null, 2)] };
  const lines = [
    out.ok(`✅ 验收${p.pass ? "通过" : "打回"}：${p.taskId}（${task.title ?? ""}）`),
    `  状态：${result.from} → ${result.to} · 结论：${review.verdict} by ${by}${p.pass ? "" : ` · 原因：${p.reject}`}`,
    ...(override ? [out.warn(`  ⚠ 已用 --force 覆盖 ${override.length} 件失效交付件（覆盖项记进 review.artifact_override）`)] : []),
    // 0.70.6（B-gm-000060）：后续改动 / 未提交改动只提示——它们不改「成果在不在」这个事实
    ...hints.map((h) => out.dim(`  ℹ ${h}`)),
    // 0.33.1：后验标签（有 trace 关联才回填；没关联就不提，免得让人以为标签机制坏了）
    ...((result.labels ?? []).length > 0
      ? [`  后验标签：${result.labels.map((l) => `${l.trace_id} → ${l.label}`).join(" · ")}（落 ${join(loc.projDir, "labels.jsonl")}；gd decision eval 可聚合）`]
      : []),
    ...(result.label_error ? [out.warn(`  ⚠ 后验标签未回填：${result.label_error}——验收结果不受影响，但该条决策不会进评估数据集`)] : []),
    // 0.49.6（F2）：「派生态」要显示**真实状态**，不是「这次变没变」。
    //   `refreshReqStatuses` 只返回**变了**的需求（历史设计：省写盘），拿它的空数组渲染成 `—`
    //   读起来就是「未知 / 无派生态」——实测 `gd check --pass` 在多任务需求上打「派生态 —」。
    //   这里在没变化时直读账算一次派生态，并标「未变」，两个事实都写明白。
    `  所属需求 ${loc.reqId}（派生态 ${result.derived[0]?.to ?? deriveCurrentReqStatus(loc)}${result.derived[0] ? "" : " · 未变"}）`,
    // 0.28.2 R-gm-090：需求验收即结子版——自动结掉了就当场告知，不藏在派生数据里
    ...(result.derived[0]?.auto_subver ? [out.ok(`  ⇒ 子版 ${result.derived[0].auto_subver} 已随本需求验收自动结版`)] : []),
    ...(result.derived[0]?.auto_error ? [out.warn(`  ⚠ 子版自动结版失败：${result.derived[0].auto_error}（需求态已落盘；可手动 gd ver reach）`)] : []),
    // 0.28.2 R-gm-090：需求回退**不自动撤**结版（结版是人的宣告），但要把不一致当面说清
    ...(result.derived[0]?.stale_subver ? [out.warn(`  ⚠ 需求已回退，但子版 ${result.derived[0].stale_subver} 仍记已结版——若要撤：gd ver reopen ${result.derived[0].stale_subver} --reason "…"`)] : []),
    out.dim("  账在板上（.git/gdtwork）：无需提交；视图可用 gd core roadmap --write 重算"),
  ];
  return { ok: true, code: 0, lines, data: { from: result.from, to: result.to, verdict: review.verdict, req: loc.reqId, labels: (result.labels ?? []).length } };
}

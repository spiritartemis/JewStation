/**
 * 板经营动作（board plans）—— **core 层**的「登账三族」实现（0.23.0 R-gm-046-02）
 *
 * 这三条命令在板模式下的**完整经营流程**（参数取义 → 判据 → 写账 → 人读回显）只写一份，两边共用：
 *   · core 面：`gd-core req new` / `gd-core task add` / `gd-core milestone add`（`scripts/core-ledger.mjs`）
 *   · 完整 CLI：同三条命令的 app 侧（注册项目账 · 写后提交 / 推送）
 *
 * 每条都是 `plan*` 形态：返回 `{ ok, lines, ... }`，**不直接决定退出码、不吞输出**——
 *   调用方只管把 `lines` 打到 stdout/stderr（core 与完整 CLI 因此**回显完全一致**）。
 *
 * 依赖方向（本文件 = core）：只依赖 core 基元（board / reqflow / subvers / lanes / defects / milestones /
 *   tasktarget-core）与 `board-ledger.mjs`。**不 import 注册表 / 引导 / 席位 / git**。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { appendEvents, readReqEntries, reqStatusOfLedger, withBoardLock } from "./board.mjs";
import { capabilityRefProblems, parseCapabilityRef, readCapIndex, writeReqBindings } from "./capability-ledger.mjs";
import { REQ_TERMINAL, nextTaskNo, readReq, readTaskList, taskIdOf } from "./reqflow.mjs";
import { idInNamespace, isReqId, devLineSegOfId, reqSeqOf, NEED_ID_RE } from "./reqid.mjs";
import { resolveNextSubver } from "./subvers.mjs";
import { isSubver } from "./subvers.mjs";
import { versionOfSubver } from "./lanes.mjs";
import { actorOf, assertLane, readLanes } from "./lanes.mjs";
import { assertLine } from "./lines.mjs";
import { validateDefectFields } from "./defects.mjs";
import { resolveSeatTarget } from "./tasktarget-core.mjs";
import { addTasks, createRequirement } from "./board-ledger.mjs";
import { MILESTONES_FILE, devLineCards, devLineSegOf, isMilestoneDate, isMilestoneVer, milestoneOfVersion, milestoneVerLabel, milestoneVersions, milestonesView, nextDevMilestoneId, nextMilestoneId, readMilestones, validateMilestones, writeMilestones } from "./milestones.mjs";
import { out } from "./style.mjs";

const err = (line) => line; // 语义标记：错误行由调用方打到 stderr（`printPlan` 按 ok 分流）

/** 统一回显：`ok` 走 stdout，失败走 stderr（两边调用方共用，保证文案一致） */
export function printPlan(plan) {
  const sink = plan.ok ? console.log : console.error;
  for (const line of plan.lines ?? []) sink(line);
  return plan.ok ? 0 : (plan.code ?? 1);
}

// ── 需求登记（`req new`）────────────────────────────────────

/** 缺陷口径参数提取（`--affects` 逗号分隔；缺省 kind=feature） */
export function defectFieldsOf(args) {
  const affects = typeof args.affects === "string" ? String(args.affects).split(",").map((v) => v.trim()).filter(Boolean) : [];
  return {
    kind: typeof args.kind === "string" ? args.kind.trim() : "feature",
    severity: typeof args.severity === "string" ? args.severity.trim() : "",
    found_in: typeof args["found-in"] === "string" ? args["found-in"].trim() : "",
    affects,
    // 0.66：缺陷挂点（能力/判据/场景）——与上面同族：只在 kind=bug 上有意义
    capability_ref: typeof args["capability-ref"] === "string" ? args["capability-ref"].trim() : "",
  };
}

/**
 * 子版号决策（`--subver` 显式 / 否则在确定的版本线内递增）：单一实现在 `lib/subvers.mjs: resolveNextSubver`。
 * 认领线优先 / 唯一线 / 多线无认领 ⇒ 拒绝——错误文案由这里统一给，两边共用。
 */
export function planSubver({ board, raw, env = process.env }) {
  const lanes = readLanes(board.root);
  return resolveNextSubver({
    reqEntries: readReqEntries(board.root),
    raw: typeof raw === "string" && raw.trim() ? raw.trim() : null,
    lanes: lanes.ok ? lanes.list : [],
    actor: actorOf(env, board),
  });
}

/**
 * `--ver` 目标解析与**版本归属闸门**。
 *
 * 新口径下建需求不再只是「给个序号」：需求 ≡ 子版，所以先得定**它落在哪个版本的哪条子版线**。
 * 判据（自上而下，任一步不过就拒并指路）：
 *   ① `x.y` 形态（`x.y.z` 是子版号，不该手写——子版号由线内自增给）
 *   ② 该版本必须归**某张里程碑**（一张里程碑 = 一个版本；否则“需求挂在没有里程碑的版本上”，账就散了）
 *   ③ 该版本线不得归他人（`assertLane`，写面归属闸门）
 * 子版号 = 该版本线内已有子版号最大值 + 1，**从 0 起、多位不补零**（`0.70.10` 合法）。
 *
 * @param {{board: object, ver: string}} o
 * @returns {{ok: true, version: string, versionSeg: string, subverNo: string, subver: string, milestone: object}
 *         | {ok: false, error: string, hint?: string}}
 */
export function planVersionTarget({ board, ver }) {
  const raw = String(ver ?? "").trim();
  if (!raw) return { ok: false, error: "缺 `--ver <x.y>`" };
  if (!isMilestoneVer(raw)) {
    return {
      ok: false,
      error: `--ver 需 \`x.y\` 形态（现值：${raw}）`,
      hint: "子版号不用手写：--ver 0.30 ⇒ 自动在此线内取下一个子版号（首个为 0.30.0）",
    };
  }
  const ms = readMilestones(board.root);
  if (!ms.ok) return { ok: false, error: `里程碑账读取失败：${ms.error}` };
  const owner = milestoneOfVersion(ms.list, raw);
  if (!owner) {
    const owned = ms.list.filter((m) => milestoneVersions(m).length > 0);
    return {
      ok: false,
      error: `版本 ${raw} 不属任何里程碑`,
      hint: owned.length
        ? `现有：${owned.map((m) => `${m.id}（${milestoneVerLabel(m)}）`).join(" · ")}`
        : "板上没有带版号的卡——版号是**存量卡**的历史字段（新模型卡只带开发线段，不带版号）",
    };
  }
  // 线内自增：只看带合法子版号且版本段相同的需求（项目账里没子版号的历史需求不参与）
  const used = readReqEntries(board.root)
    .map((r) => String(r?.subver ?? "").trim())
    .filter((v) => isSubver(v) && versionOfSubver(v) === raw)
    .map((v) => Number(v.split(".")[2]) || 0);
  const subverNo = String(used.length === 0 ? 0 : Math.max(...used) + 1);
  return { ok: true, version: raw, versionSeg: raw.split(".")[1], subverNo, subver: `${raw}.${subverNo}`, milestone: owner };
}

/**
 * `--line <开发线段>` 目标解析与**开发线归属闸门**（两轴模型的新入口）。
 *
 * 判据（自上而下，任一步不过就拒并指路）：
 *   ① 线段形态：`<数字><线别字母>`（`1a`）——开发线段 = 里程碑 id 去 `m-` 前缀
 *   ② 该线必须有一张**开发线卡**（里程碑）——否则需求无处挂
 *   ③ 线内序号 = 该线上已有开发形态需求的最大序号 + 1（从 0 起，多位不补零）
 *
 * @param {{board: object, line: string}} o
 * @returns {{ok: true, line: string, seq: string, milestone: object, cardId: string}
 *         | {ok: false, error: string, hint?: string}}
 */
export function planDevLineTarget({ board, line }) {
  const raw = String(line ?? "").trim();
  if (!raw) return { ok: false, error: "缺 `--line <开发线段>`" };
  if (!/^\d+[a-z]$/.test(raw)) {
    return {
      ok: false,
      error: `--line 需 \`<数字><线别字母>\` 形态（现值：${raw}）`,
      hint: "开发线段 = 里程碑 id 去 m- 前缀（如 m-1a ⇒ 1a）；线内序号不用手写",
    };
  }
  const ms = readMilestones(board.root);
  if (!ms.ok) return { ok: false, error: `里程碑账读取失败：${ms.error}` };
  const cards = devLineCards(ms.list);
  const hit = cards.find((c) => c.seg === raw);
  if (!hit) {
    return {
      ok: false,
      error: `开发线 ${raw} 不在板上`,
      hint: cards.length
        ? `现有：${cards.map((c) => `${c.id}（${c.seg}）`).join(" · ")}`
        : "板上还没有开发线卡——先 `gd milestone add \"<名称>\" --target <YYYY-MM-DD> --alias <意涵缩写>` 开一张（id 形态 m-<数字><线别>）",
    };
  }
  const used = readReqEntries(board.root)
    .map((r) => (devLineSegOfId(String(r?.id ?? "")) === raw ? Number(reqSeqOf(String(r?.id ?? ""))) : -1))
    .filter((n) => n >= 0);
  const seq = String(used.length === 0 ? 0 : Math.max(...used) + 1);
  return { ok: true, line: raw, seq, milestone: hit.card, cardId: hit.id };
}

/**
 * 建需求前的**全部闸门**（id 口径 + 版本线归属 + 缺陷字段）——`req new` 与 `req apply` **共用这一份**。
 *
 * 为什么要抽出来（R-gm-48-0 T-02）：`req apply` 原先自己写了一套「只认 `--subver`」的老口径，
 *   于是同一条板上 `gd req new` 落 `R-<板>-47-0`、`gd req apply` 落 `R-<板>-001` —— 同一个动作两个编号空间。
 *   判据：**口径只能有一份**，两条路各写一遍必然「哪条路宽松哪条是后门」。
 *
 * 两轴模型（当前）：板上存在**开发线卡**（id 形态 `m-<数字><线别>`）⇒ 新模型板，
 *   feature/chore 只能走 `--line <开发线段>`（id 落 `R-<板>-<线段>-<线内序号>`）；
 *   否则是存量板，行为逐字不变（`--ver` / `--subver` 照旧）。
 *
 * @param {{board: object, ver?: string|null, subver?: string|null, line?: string|null, defect?: object|null, force?: boolean, env?: object}} o
 * @returns {{ok: true, isBugKind: boolean, newSchemeBoard: boolean, devModelBoard: boolean, target: object|null, sub: {value: string}}
 *         | {ok: false, code: number, lines: string[]}}
 */
export function planReqCreateGate({ board, ver = null, subver = null, line = null, defect = null, force = false, env = process.env }) {
  const isBugKind = (defect?.kind ?? "feature") === "bug";
  const rawVer = String(ver ?? "").trim();
  const rawSub = String(subver ?? "").trim();
  const rawLine = String(line ?? "").trim();
  // 三选一：--line（新）· --ver（旧 · 版本线）· --subver（存量）
  const picked = [rawLine && "--line", rawVer && "--ver", rawSub && "--subver"].filter(Boolean);
  if (picked.length > 1) {
    return {
      ok: false,
      code: 1,
      lines: [
        err(`✗ ${picked.join(" / ")} 互斥（三选一）`),
        out.dim("  · 新口径：--line 1a（开发线段；id 落 R-<板>-1a-0 形态）"),
        out.dim("  · 旧口径：--ver 0.30（版本线）· --subver 0.24.3（存量 3 位 id）"),
      ],
    };
  }
  if (rawLine && isBugKind) {
    return {
      ok: false,
      code: 1,
      lines: [
        err("✗ 缺陷不用 --line（缺陷 id 不带开发坐标：`B-<板>-<6位>`）"),
        out.dim("  · 记发现于哪个版本用 --found-in <x.y.z>；对外版本归属由发版账记"),
      ],
    };
  }
  // 0.28.3 R-gm-091：`--ver` 与 `--subver` 互斥——前者是新口径（区间闸门 + 线内自增），后者是存量口径
  if (rawVer && rawSub) {
    return {
      ok: false,
      code: 1,
      lines: [err("✗ --ver 与 --subver 互斥（二选一）"), out.dim("  · 新口径：--ver 0.30（子版号自动给，id 落 R-<板>-30-0 形态）"), out.dim("  · 存量口径：--subver 0.24.3（id 仍为 R-<板>-NNN）")],
    };
  }
  if (rawVer && isBugKind) {
    return {
      ok: false,
      code: 1,
      lines: [
        err("✗ 缺陷不用 --ver（缺陷 id 不带版本坐标：`B-<板>-<6位>`）"),
        out.dim("  · 记发现于哪个版本用 --found-in <x.y.z>；版本归属由需求验收派生"),
      ],
    };
  }
  // 0.49.6 F6：**缺陷不占版本坐标**——不接 `--subver`，也不像 feature 那样推断一个。
  //   版本信息只走 `--found-in`（发现处）+ `--affects`（受影响版本）；结版 blocker 门禁按 `found-in` 的 x.y 线判
  //   （`defects.mjs: openBlockersOf` 同批改）。
  //   为什么不也给 `--subver`：一个字段两个含义（“发现处”与“归哪条子版修”）必然漂移；
  //   且缺陷 id `B-<板>-<6位>` 本就不带版本坐标（protocol §3.7）。
  if (isBugKind && rawSub) {
    return {
      ok: false,
      code: 1,
      lines: [
        err("✗ 缺陷不使用 --subver（缺陷不占版本坐标）"),
        out.dim("  · 版本信息这样记：--found-in <x.y.z>（发现时正在验的版本）· --affects <x.y,…>（受影响版本，判断要不要 backport）"),
        out.dim("  · 结版 blocker 门禁按 found-in 的版本线判；缺陷 id 恒为 B-<板>-<6位>"),
      ],
    };
  }
  // 板形态判据：
  //   · **新模型板** = 板上存在开发线卡（id 形态 `m-<数字><线别>`）⇒ feature/chore 只能走 `--line`
  //   · 缺陷号 6 位判据 = 新模型板 **或** 存量卡里带版号的（存量兼容：gm 板保持 6 位）
  const ms0 = readMilestones(board.root);
  const devCards = ms0.ok ? devLineCards(ms0.list) : [];
  const devModelBoard = devCards.length > 0;
  const newSchemeBoard = devModelBoard || (ms0.ok && ms0.list.some((m) => milestoneVersions(m).length > 0));

  // ── 开发线入口（两轴模型的新形态）：需求坐标 = 开发线段，不带版本 ──
  if (rawLine) {
    if (isBugKind) {
      return { ok: false, code: 1, lines: [err("✗ 缺陷不用 --line（缺陷 id 不带开发坐标）"), out.dim("  · 记发现于哪个版本用 --found-in <x.y.z>；对外版本归属由发版账记")] };
    }
    const t = planDevLineTarget({ board, line: rawLine });
    if (!t.ok) return { ok: false, code: 1, lines: [err(`✗ ${t.error}`), ...(t.hint ? [out.dim(`  · ${t.hint}`)] : [])] };
    // 开发线归属闸门（线归他人时拒，--force 越过）
    const gate = assertLine(board.root, t.line, { board, force });
    if (gate) return { ok: false, code: 1, lines: [err(`✗ ${gate.error}`), `  · ${gate.hint}`] };
    const bad0 = validateDefectFields(defect);
    if (bad0) return { ok: false, code: 1, lines: [err(`✗ ${bad0.error}`), ...(bad0.hint ? [out.dim(`  · ${bad0.hint}`)] : [])] };
    return { ok: true, isBugKind, newSchemeBoard, devModelBoard, target: { kind: "dev", ...t }, sub: { value: null } };
  }

  // ── 存量口径的**显式逃生口**（两轴模型）──
  //   开发线板上「什么都不给」必须拒（缺省会静默落 legacy 3 位 id，那是 0.47 修的洞）；
  //   但**显式给了 `--subver`** 是明确选择存量口径（id 形态肉眼可辨），放行并出声——
  //   历史板与迁移期的夹具都要靠它，堵死只会逼人绕过闸门。
  if (devModelBoard && rawSub && !isBugKind) {
    const sub1 = planSubver({ board, raw: rawSub, env });
    if (sub1.error) return { ok: false, code: 1, lines: [err(`✗ ${sub1.error}`), ...(sub1.hint ? [out.dim(`  · ${sub1.hint}`)] : [])] };
    const gate1 = assertLane(board.root, sub1.value, { board, force });
    if (gate1) return { ok: false, code: 1, lines: [err(`✗ ${gate1.error}`), `  · ${gate1.hint}`] };
    const bad1 = validateDefectFields(defect);
    if (bad1) return { ok: false, code: 1, lines: [err(`✗ ${bad1.error}`), ...(bad1.hint ? [out.dim(`  · ${bad1.hint}`)] : [])] };
    return {
      ok: true,
      isBugKind,
      newSchemeBoard,
      devModelBoard,
      target: null,
      sub: { value: sub1.value },
      notice: "显式走了存量口径（--subver）⇒ id 落 3 位形态，不占开发线序号",
    };
  }

  // 0.47 B-gm-000023：新口径板上 feature/chore 只能走 `--ver`。
  //   为什么不是「给了 --subver 才拒」：`--subver` 缺省时 planSubver 会自己填一个默认子版号，
  //     照样落 legacy 3 位 id —— 真正的洞是「没走 --ver 就默认落进存量口径」，不是「写了 --subver」。
  //   为什么不当警告：id 形态是「这条需求属于哪个版本」的唯一机械凭证（v2 id 自带版本坐标）。
  //     发错号不报任何错，却让 subver 字段与 id 互相矛盾，按 id 反解版本 / 按版本段找需求全部失准。
  //   为什么不留「显式落存量口径」的旗标：那等于把同一个洞换个名字留着——新口径板上没有正当理由
  //     再造 legacy 号；确有需要就把那条需求挂到没有版号的板上（判据是板，不是旗标）。
  if (!rawVer && !isBugKind && newSchemeBoard) {
    return {
      ok: false,
      code: 1,
      lines: [
        err(devModelBoard
          ? "✗ 新模型板上建需求必须用 --line <开发线段>（或 --ver <x.y> 落存量版本线；--subver / 都不给 都会静默落 legacy 3 位 id）"
          : "✗ 新口径板上建需求必须用 --ver <x.y>（--subver / 都不给 都会静默落 legacy 3 位 id）"),
        ...(devModelBoard ? [out.dim('  · 新模型线：gd req new "标题" --line 1a  ⇒ 线内序号自增，id 落 R-<板>-1a-0 形态')] : []),
        out.dim('  · 存量版本线：gd req new "标题" --ver 0.47  ⇒ 子版号线内自增，id 落 R-<板>-47-0 形态'),
        out.dim("  · 判据是板：本板存在带版号的卡（新模型卡则看开发线）"),
        out.dim("  · 缺陷不受影响：B-<板>-<6位> 恒 6 位，版本归属由发版账记"),
      ],
    };
  }

  // 新口径：先过区间归属闸门，拿到线内下一个子版号；线归属仍走同一道 assertLane
  let target = null;
  let sub;
  if (rawVer) {
    const t = planVersionTarget({ board, ver: rawVer });
    if (!t.ok) return { ok: false, code: 1, lines: [err(`✗ ${t.error}`), ...(t.hint ? [out.dim(`  · ${t.hint}`)] : [])] };
    target = t;
    sub = { value: t.subver };
  } else if (isBugKind) {
    sub = { value: null }; // 0.49.6 F6：缺陷不推断子版号（账上不写版本归属）
  } else {
    sub = planSubver({ board, raw: subver, env });
  }
  // 0.21.5：版本线归属闸门（该线归他人时拒，--force 越过）
  const gate = assertLane(board.root, sub.value, { board, force });
  if (gate) return { ok: false, code: 1, lines: [err(`✗ ${gate.error}`), `  · ${gate.hint}`] };
  if (sub.error) return { ok: false, code: 1, lines: [err(`✗ ${sub.error}`), ...(sub.hint ? [out.dim(`  · ${sub.hint}`)] : [])] };

  // 0.49.6 F6：旧的 B-gm-000034 闸门（「缺陷缺省会落到已结版线 ⇒ 拒」）已退场：
  //   缺陷现在根本不取缺省子版号，那个洞从源头消失；存量缺陷账已写上的 subver 仍可读（兼容）。
  const bad = validateDefectFields(defect);
  if (bad) return { ok: false, code: 1, lines: [err(`✗ ${bad.error}`), `  · ${bad.hint}`] };

  return { ok: true, isBugKind, newSchemeBoard, devModelBoard: false, target, sub };
}

/**
 * `needs` 形态闸门 —— **`req new` 与 `req update` 共用这一份**（m-7 0.70.0）。
 *
 * 为什么抽出来：口径按「**动作**」划分，不按「命令」划分。两条写面各写一套形态判据 ⇒
 *   同一条需求经两条路进来形态可以不同，**而且全程不报错**（0.48.0 实测过同族的
 *   `req new` / `req apply` id 口径分叉，同板并存 `R-x-47-0` 与 `R-x-001`）。
 *
 * 语义：`needs == null` = **没给**（合法，缺省不声明）；给了就必须合规 ——
 *   **显式给了空值 ≠ 没给**（`""` / 全空白都算给了空值）。
 *
 * @param {string|string[]|null|undefined} needs 原样入参（`--needs` 可重复 ⇒ 数组或单值）
 * @returns {{ok:true, needs:string[]|null, given:boolean} | {ok:false, lines:string[]}}
 */
export function planNeedsGate(needs) {
  if (needs == null) return { ok: true, needs: null, given: false };
  const raw = Array.isArray(needs) ? needs : [needs];
  // 只认字符串值：`--needs` 后面没跟值 ⇒ parseArgs 给布尔 `true`，那等于「给了个空值」，不是「值就是 true」
  const wants = raw.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
  if (wants.length === 0) {
    return { ok: false, lines: [err("✗ needs 给了空值（E_NEEDS_SHAPE）：不想声明就别给 --needs")] };
  }
  const badShape = wants.filter((x) => !NEED_ID_RE.test(x));
  if (badShape.length > 0) {
    return {
      ok: false,
      lines: [
        err(`✗ needs 形态不合规（E_NEEDS_SHAPE）：${badShape.join(" / ")}`),
        out.dim("  · 只接受 kebab-case 裸专业能力 id（如 design / doc-write / numeric），**不带 owner 前缀**"),
        out.dim("  · 需求不认识 producer 名录：写 design，不写 forge-design"),
      ],
    };
  }
  const dup = [...new Set(wants.filter((x, i) => wants.indexOf(x) !== i))];
  if (dup.length > 0) {
    return { ok: false, lines: [err(`✗ needs 有重复项（E_NEEDS_SHAPE）：${dup.join(" / ")}`)] };
  }
  return { ok: true, needs: wants, given: true };
}

/**
 * 板模式建需求（core 层：不碰注册表、不碰席位；编号 R-<板id>-<seq> / B-… 锁内自增）。
 * @param {{board: object, title: string, summary?: string, subver?: string|null, ver?: string|null, defect?: object|null, force?: boolean, env?: object}} o
 *   `ver`：新口径入口（`--ver 0.30`）——走区间闸门 + 线内自增，id 落新形态；给了 `ver` 就不接 `subver`。
 * @returns {{ok: boolean, lines: string[], reqId?: string, code?: number}}
 */
export function reqNewOnBoard({ board, title, summary = "", subver = null, ver = null, line = null, defect = null, force = false, env = process.env, capabilities = [], delta = "", needs = null }) {
  if (board?.error) {
    return { ok: false, code: 1, lines: [err(`✗ 未定位到板：${board.error}`), "  · 建板：gd core init   · 临时切板：export GD_BOARD=<板根目录>"] };
  }
  const scheme = planReqCreateGate({ board, ver, subver, line, defect, force, env });
  if (!scheme.ok) return scheme;
  // ── m-7 0.70.0：需求能力诉求 `needs` 的形态闸门（`E_NEEDS_SHAPE`，与 `req update` 同一份）──
  //   放在能力挂点闸门**之前**：形态是纯字符串判据，不依赖账；先报「你写错了」比先报「账里没有它」更治根。
  //   `needs == null` = 没给（合法，缺省不声明）；给了就必须合规 —— 显式给了空值 ≠ 没给。
  const needsGate = planNeedsGate(needs);
  if (!needsGate.ok) return { ok: false, code: 1, lines: needsGate.lines };
  const needsWants = needsGate.needs ?? [];
  // 0.64：挂能力是**前置闸门**——能力 / delta 不存在就别建单（建单是单一动作，
  //   不能出现「需求建了、挂点没落」那种半张单）
  const capWants = (Array.isArray(capabilities) ? capabilities : capabilities ? [capabilities] : []).filter(
    (x) => typeof x === "string" && x.trim(),
  );
  // 0.66：缺陷挂点（能力/判据/场景）——写面同一套存在性闸门，不留悬空引用
  if (defect?.capability_ref) {
    const parsedRef = parseCapabilityRef(defect.capability_ref);
    if (!parsedRef.ok) return { ok: false, code: 1, lines: [err(`✗ ${parsedRef.error}`)] };
    const refProbs = capabilityRefProblems({ projDir: board.root, ref: parsedRef.ref });
    if (refProbs.length > 0) {
      return {
        ok: false,
        code: 1,
        lines: [err(`✗ 能力挂点不合规：`), ...refProbs.map((x) => `  · ${x}`), out.dim("  · 看已有：gd cap list / gd cap show <能力id>")],
      };
    }
  }
  if (capWants.length > 0 || delta) {
    const idx = readCapIndex(board.root);
    const existCaps = new Set((idx.capabilities ?? []).map((c) => String(c.id)));
    const missingCaps = capWants.filter((c) => !existCaps.has(String(c).trim()));
    if (missingCaps.length > 0) {
      return {
        ok: false,
        code: 1,
        lines: [
          err(`✗ 能力不存在：${missingCaps.join(" / ")}`),
          out.dim("  · 先立能力：gd cap new \"<能力标题>\" --id <能力id> --domain <域>   · 看已有：gd cap list"),
        ],
      };
    }
    // 判据次序：先问「改哪项能力」（语义前提），再问「文件在不在」（形态前提）——反过来会给出
    //   「文件不存在」这种治不了根的提示
    if (delta && capWants.length === 0) {
      return { ok: false, code: 1, lines: [err("✗ 给了 --delta 却没给 --capability（delta 得说清改的是哪项能力）")] };
    }
    if (delta && !existsSync(join(board.root, String(delta)))) {
      return { ok: false, code: 1, lines: [err(`✗ delta 文件不存在：${delta}`), out.dim("  · 先写 delta：reqs/<需求id>/specs/<能力id>.md（建单前可先放临时位置，用 gd cap import 收编）")] };
    }
  }
  const { isBugKind, newSchemeBoard, target, sub } = scheme;

  let created;
  try {
    created = createRequirement({
      projDir: board.root,
      pid: board.id,
      title,
      summary,
      subver: sub.value,
      defect,
      // 新形态 id：版本段 + 子版号（两段都进 id，不再借全局序号）
      v2: target && target.kind !== "dev" ? { versionSeg: target.versionSeg, subverNo: target.subverNo } : null,
      // 两轴模型的新形态 id：开发线段 + 线内序号（两段都进 id；不借全局序号）
      dev: target && target.kind === "dev" ? { lineSeg: target.line, seq: target.seq } : null,
      bugDigits: newSchemeBoard ? 6 : 3,
    });
  } catch (e) {
    return { ok: false, code: 1, lines: [err(`✗ ${e.message}`)] };
  }
  const { reqId, created: createdOn } = created;
  const isBug = isBugKind;
  const lines = [
    out.ok(`✅ ${isBug ? "缺陷已登记" : "需求已登记"}：${reqId}（${title}）`),
    `  板: ${board.id}${sub.value ? ` · 子版: ${sub.value}` : ""} · 状态: ready · 创建: ${createdOn}`,
  ];
  if (target && target.kind === "dev") {
    lines.push(out.dim(`  开发线: ${target.line}（归里程碑 ${target.milestone.id}）· 线内序号 ${target.seq} 为线内自增`));
    lines.push(out.dim("  版本坐标归发版账（gd release）——需求不再挂版本号"));
  } else if (target) {
    lines.push(out.dim(`  版本: ${target.version}（归里程碑 ${target.milestone.id}）· 子版号 ${target.subverNo} 为线内自增`));
  }
  if (isBug && newSchemeBoard) lines.push(out.dim("  新口径板：缺陷号 6 位（B-<板>-000004 式），序号接既有 next_bug_no 不重置"));
  if (isBug && defect.capability_ref) lines.push(`  能力挂点: ${defect.capability_ref}（违反的判据/场景）`);
  if (isBug) {
    lines.push(`  缺陷: ${defect.severity}${defect.severity === "blocker" ? out.warn("（阻塞结版）") : ""} · 发现于 ${defect.found_in}${defect.affects?.length ? ` · 影响 ${defect.affects.join(",")}` : ""}`);
    if (defect.severity === "blocker") lines.push(out.dim("  提醒：blocker 未完成时该子版 reach 会被拒；若影响已发布版本，是否 backport 开子版由人定"));
  }
  if (capWants.length > 0) {
    const bindings = capWants.map((cid, i) => ({ id: String(cid).trim(), role: i === 0 ? "owner" : "consumer", delta: i === 0 ? String(delta ?? "").trim() : "" }));
    const wrote = writeReqBindings({ projDir: board.root, reqId, bindings, by: board.id });
    lines.push(`  能力: ${bindings.map((b) => `${b.id}(${b.role})`).join(" · ")}${wrote ? "" : out.dim("（挂点未变）")}`);
    const owner = bindings.find((b) => b.role === "owner");
    if (owner?.delta) lines.push(out.dim(`  合入：gd cap merge ${owner.id} --req ${reqId}（建单不自动合入 —— 合入是显式动作）`));
    else lines.push(out.dim(`  · 还没给 delta：--delta reqs/${reqId}/specs/<能力id>.md（0.63 的 delta 三段式）`));
  }
  lines.push(out.dim(`  账：${board.root}/reqs/${reqId}/task-list.yaml`));
  lines.push(out.dim(`  下一步（会话语义）：gd work claim <任务id> / gd milestone update <id> --req-add ${reqId}`));
  return { ok: true, lines, reqId };
}

// ── 拆任务（`task add`）────────────────────────────────────

/** 解析 `--task "[执行体id:]标题"`：无冒号（或冒号前为空）= 未派 */
export function parseTaskSpecs(rawTasks) {
  const parsed = [];
  const errors = [];
  for (const t of Array.isArray(rawTasks) ? rawTasks : []) {
    if (typeof t !== "string" || t === true) {
      errors.push(`--task 格式应为 "[执行体id:]标题"（收到 "${t}"）`);
      continue;
    }
    const idx = t.indexOf(":");
    const agent = idx < 0 ? "" : t.slice(0, idx).trim();
    const title = (idx < 0 ? t : t.slice(idx + 1)).trim();
    if (!title) errors.push(`--task "${t}"：标题为空`);
    parsed.push({ agent, title });
  }
  return { parsed, errors };
}

/**
 * 板模式拆任务：需求须在本板 → 版本线闸门 → 目标判据 → 追加任务账。
 *
 * @param {{board: object, reqId: string, tasks: {agent: string, title: string}[], force?: boolean,
 *          resolveTarget?: (agent: string) => object, commitHint?: string}} o
 *   `resolveTarget`：目标判据（默认 core 口径 = 板内名册 ∪ 自产哨兵；完整 CLI 注入席位/worker 更宽的口径）
 * @returns {{ok: boolean, lines: string[], code?: number}}
 */
export function taskAddOnBoard({ board, reqId, tasks, force = false, resolveTarget = null, commitHint = null }) {
  if (board?.error) {
    return { ok: false, code: 1, lines: [err(`✗ 未定位到板：${board.error}`), "  · 建板：gd core init   · 临时切板：export GD_BOARD=<板根目录>"] };
  }
  // 写面归属按**数据事实**判：席位语义的板 ⇒ 任务写面仍在席位自己的面上（不在这里开口子）
  if (board.mode === "seat") {
    return {
      ok: false,
      code: 1,
      lines: [
        err(`✗ 板 ${board.id} 处于席位语义（<板根>/seats/index.yaml 存在）——任务写面在席位自己的面上`),
        '  · 等价路径：gd seat task add <需求id> --task "…"（席位上下文）',
      ],
    };
  }
  // 0.23.0 R-gm-061：需求 id 前缀按 kind 分家（R / B），两者都属本板
  if (!isReqId(reqId) || !idInNamespace(board.id, reqId)) {
    return { ok: false, code: 1, lines: [err(`✗ 需求 "${reqId}" 不属于本板（板 id ${board.id}，需求 id 应为 R-${board.id}-001 或 B-${board.id}-001）`)] };
  }
  // 0.21.5：版本线归属闸门——按该需求的 subver 判线
  const entry = readReqEntries(board.root).find((r) => String(r.id) === String(reqId));
  const gate = assertLane(board.root, entry?.subver, { board, force });
  if (gate) return { ok: false, code: 1, lines: [err(`✗ ${gate.error}`), `  · ${gate.hint}`] };

  const req = readReq(board.root, reqId);
  if (!req) return { ok: false, code: 1, lines: [err(`✗ 需求条目缺失（reqs/index.yaml 中无 ${reqId}）`)] };
  // 终态保护：需求 done（完结锁定）不可追加任务
  if (REQ_TERMINAL.includes(req.status)) {
    return { ok: false, code: 1, lines: [err(`✗ 需求 ${reqId} 已完结（${req.status}），禁止追加任务（gd req delete 亦不可撤）`)] };
  }
  const judge = resolveTarget ?? ((agent) => resolveSeatTarget(board.root, agent));
  for (const p of tasks) {
    if (!p.agent) continue; // agent 留空 = 未派 ⇒ 跳过目标校验（派单时再判）
    const t = judge(p.agent);
    if (!t.ok) return { ok: false, code: 1, lines: [err(`✗ ${t.reason}`), `  可用：${t.known.join(" / ")}`] };
  }
  // 需求须有任务账，避免对无任务需求误追加
  if (!readTaskList(board.root, reqId)) {
    return { ok: false, code: 1, lines: [err(`✗ 需求 ${reqId} 无任务账（task-list.yaml）。首批任务请用完整 CLI 的批次建任务（task gen <需求id>）`)] };
  }

  const created = new Date().toISOString().slice(0, 10);
  const baseNo = nextTaskNo(board.root, reqId);
  const createdTasks = tasks.map((p, i) => ({
    id: taskIdOf(board.id, reqId, baseNo + i),
    title: p.title,
    executor: p.agent,
    created,
    input: "（待总控补充输入）",
  }));
  let result;
  try {
    result = addTasks(board.root, reqId, createdTasks);
  } catch (e) {
    return { ok: false, code: 1, lines: [err(`✗ 追加失败：${e.message}`)] };
  }
  const lines = [
    out.ok(`✅ 需求已追加任务：${reqId}（${req.title}）→ 新增 ${createdTasks.length} 个（共 ${result.ledger.tasks.length}）`),
    ...createdTasks.map((t) => `  · ${t.id}  ${t.executor || "（未派）"}  ${t.title}`),
    `  需求状态: ${reqStatusOfLedger(result.ledger)}（派生）· 新任务初始: ready（待办）`,
    out.dim(commitHint ?? `  账在板上（${board.root}，不入提交）：认领 gd work claim <任务id>`),
  ];
  return { ok: true, lines };
}

// ── 里程碑（`milestone add`）────────────────────────────────

/**
 * 构造 `milestone add` 的新条目（校验 + 编号 + 别名）。
 * @param {{list: object[], name: string, target: string, status?: string|null, alias?: string|null, ver?: string|null, note?: string, reqs?: string[]}} o
 * @returns {{ok: boolean, lines: string[], milestone?: object, list?: object[]}}
 */
export function buildMilestoneAdd({ list, name, target, status = null, alias = null, series = null, note = "", reqs = [] }) {
  if (String(name ?? "").trim() === "") return { ok: false, lines: [err("✗ 参数校验未通过："), "  · 缺少里程碑名称（gd milestone add \"<名称>\" --target <YYYY-MM-DD>）"] };
  if (!isMilestoneDate(target)) return { ok: false, lines: [err("✗ 参数校验未通过："), `  · 缺少 / 非法 \`--target <YYYY-MM-DD>\`（必填；现值：${target ?? "空"}）`] };
  if (status && status !== "planned" && status !== "in_progress") {
    return { ok: false, lines: [err("✗ 参数校验未通过："), `  · --status 只接受 planned | in_progress（达成走 \`gd milestone reach <id>\`；现值：${status}）`] };
  }
  // 两轴模型：**一切新卡都是开发线卡**——id 铸 `m-<序号><代际字母>`（如 `m-1a`）。
  //   序号在**代际内**自增，与存量纯数字卡（`m-1` … `m-6`）互不避让：`m-1a` 与 `m-1` 是两张不同的卡
  //   （形态不同 ⇒ `findMilestone` 不跨形态归一，见 lib/milestones.mjs）。
  const m = { id: nextDevMilestoneId(list, series ?? "a"), name: String(name), target: String(target), status: status ?? "planned", reached_on: null, reqs: Array.isArray(reqs) ? reqs.filter(Boolean) : [], note: typeof note === "string" ? note : "" };
  // 版本号别名（只供人读检索，不参与排序）
  if (typeof alias === "string" && alias.trim()) m.alias = alias.trim();
  return { ok: true, lines: [], milestone: m, list: [...list, m] };
}

/** 需求 id → 状态（关联需求进度用；与页面同一派生口径：都过 milestonesView 的 reqStatusById） */
export function reqStatusOf(projDir) {
  return Object.fromEntries(readReqEntries(projDir).map((r) => [String(r.id), String(r.status ?? "")]));
}

/** 里程碑账校验失败的回显行（写前校验用） */
export function milestoneInvalidLines(invalid) {
  return [err("✗ 里程碑账校验未通过："), ...invalid.map((e) => `  · [${e.code}] ${e.id}：${e.msg}`)];
}

/**
 * 写里程碑账前的准备：校验 → 派生视图（**不落盘**）。
 * `status` 是账面真值（可多张进行中），不做任何接棒改写。
 * @returns {{ok: boolean, lines?: string[], list?: object[], view?: object}}
 */
export function prepareMilestoneWrite({ projDir, list }) {
  const reqIds = readReqEntries(projDir).map((r) => String(r.id));
  const invalid = validateMilestones(list, { reqIds });
  if (invalid.length > 0) return { ok: false, lines: milestoneInvalidLines(invalid) };
  const view = milestonesView(list, Date.now(), { reqStatusById: reqStatusOf(projDir) });
  return { ok: true, list, view };
}

/** 里程碑写面进板锁（0.21.8：与其它写面并发时不互相覆盖；锁内落盘后自动打账快照）
 *  `events`：同一把锁内追加的事件（留痕与写盘同临界区 —— 不会出现「写了没留痕」的中间态） */
export function writeMilestoneList({ projDir, list, label = "milestone 写", events = null }) {
  return withBoardLock(projDir, () => {
    const path = writeMilestones(projDir, list);
    if (events) {
      for (const e of events) appendEvents(projDir, e.reqId ?? null, e.entries ?? []);
    }
    return path;
  }, { label });
}

/** 里程碑写面成功回显（core 面；完整 CLI 另有提交 / 推送回显） */
export function milestoneWrittenLines({ action, summary, view, fileLabel = `<板根>/${MILESTONES_FILE}` }) {
  const active = (view.summary.active_ids ?? []).join(" / ") || "无";
  return [out.ok(`✅ ${action}：${summary}`), `  ${fileLabel} 已更新（${view.summary.reached}/${view.summary.total} 已达成 · 进行中 ${active}）`];
}

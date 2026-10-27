/**
 * 板的派生视图（roadmap view）—— **唯一实现**（core 层）。
 *
 * `roadmap.md` 是板的派生视图：里程碑 → 需求 → 任务三层账在板上，本模块只负责把账**渲染**成人读的 markdown。
 * **账是真相，视图随时可重算**；手改视图不影响任何派生态与门禁。
 * 依赖方向：只依赖 core 层件（node 内置 + `yaml.mjs` / `milestones.mjs` / `board.mjs`），不 import 席位 / 工作站 / 注册表。
 * 渲染块用一对标记包裹（`<!-- gd:board-view:begin -->` / `end`），`--write` 只替换标记之间——视图外永不被覆盖。
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { devLineSegOf, milestoneVerLabel, milestoneVersions, milestonesView, readMilestones, versionProgressOf } from "./milestones.mjs";
import { ledgerBlock, readAllLedgers, readReqEntries } from "./board.mjs";
import { closedOf, latestClosedSubver, readSubvers } from "./subvers.mjs"; // 0.21.4：子版级结版事实 · 0.23.0：顶行兜底版本号
import { readReleases, releasesView } from "./releases.mjs"; // 两轴模型：发布轴的发版账
import { devLineSegOfId } from "./reqid.mjs"; // 两轴模型：需求 id 里的开发线段

export const VIEW_BEGIN = "<!-- gd:board-view:begin（账在板上，本块由 gd core roadmap --write 重算，勿手改） -->";
export const VIEW_END = "<!-- gd:board-view:end -->";

const STATUS_ZH = { ready: "待办", in_progress: "进行中", review: "待验收", done: "已完成" };
const M_STATUS_ZH = { planned: "未开始", in_progress: "进行中", reached: "已达成" };

/** 读板上的三层账（里程碑 / 需求 / 任务），返回纯数据（渲染与 --json 共用） */
export function readBoardFacts(board) {
  const reqs = readReqEntries(board.root).map((r) => ({
    id: String(r.id ?? ""),
    title: String(r.title ?? ""),
    status: String(r.status ?? ""),
    subver: String(r.subver ?? "").trim(), // x.y.z（子版 ↔ 需求 1:1；为空 = 未编号）
    revision: r.revision ?? null,
  }));
  // 里程碑进度要读「关联需求是否已完成」⇒ 需求表先就位，再算视图（否则 reqs_done 恒 null，界面永远 0/N）
  const ms = readMilestones(board.root);
  const list = ms.ok ? ms.list : [];
  const reqStatusById = Object.fromEntries(reqs.map((r) => [r.id, r.status]));
  const view = milestonesView(list, Date.now(), { reqStatusById });
  const ledgers = readAllLedgers(board.root);
  const tasks = [];
  for (const [reqId, ledger] of ledgers) {
    for (const t of ledger.tasks) {
      tasks.push({
        id: String(t.id ?? ""),
        title: String(t.title ?? ""),
        status: String(t.status ?? ""),
        executor: String(t.executor ?? ""),
        claim: t.claim ?? null,
        req: reqId,
      });
    }
  }
  const reqCounts = new Map(reqs.map((r) => [r.id, { done: 0, total: 0 }]));
  for (const t of tasks) {
    const c = reqCounts.get(t.req);
    if (!c) continue;
    c.total++;
    if (t.status === "done") c.done++;
  }
  const sv = readSubvers(board.root);
  const rl = readReleases(board.root);
  const releases = rl.ok ? releasesView(rl.list, { reqStatusById }).items : [];
  return { milestones: view.items, summary: view.summary, reqs, tasks, reqCounts, milestonesError: ms.ok ? null : ms.error, subvers: sv.ok ? sv.list : [], subversError: sv.ok ? null : sv.error, releases, releasesError: rl.ok ? null : rl.error };
}

/**
 * 版本 / 子版派生（**不另建实体**）：子版号挂在需求上，按 `x.y` 前缀分组出「版本」。
 * 派生态：子版 reached = 其下需求全 done；版本 reached = 其下子版全 reached。
 * 里程碑有版号但还没排活的版本也占一行（状态「未排活」）——一张里程碑 = 一个版本，版本行始终点名。
 */
export function deriveVersionTree(facts) {
  const tree = facts.milestones.map((m) => ({
    milestone: String(m.id ?? ""),
    milestoneName: String(m.name ?? ""),
    version: milestoneVerLabel(m),
    versions: mergePlannedVersions(
      groupByVersion(facts.reqs.filter((r) => (m.reqs ?? []).includes(r.id))),
      milestoneVersions(m),
    ),
  }));

  // 未挂任何里程碑的需求：单独一组（**不静默丢**——历史上有需求因"先完成再挂"被拒挂成孤儿）
  const attached = new Set(facts.milestones.flatMap((m) => m.reqs ?? []));
  const orphans = facts.reqs.filter((r) => !attached.has(r.id));
  if (orphans.length > 0) {
    tree.push({ milestone: "(未挂里程碑)", milestoneName: "未挂任何里程碑的需求", version: "", versions: groupByVersion(orphans) });
  }
  return tree;
}

/**
 * 把里程碑版号里的**计划版本**补进派生结果：已排活的保留原样，空版本补占位行（`planned: true`）。
 * 没有版号的卡（存量 m-1 / m-2 未登记版号）⇒ 原样返回，行为与改造前一致。
 */
function mergePlannedVersions(derived, planned) {
  if (planned.length === 0) return derived;
  const have = new Set(derived.map((v) => v.alias));
  return [...derived, ...planned.filter((v) => !have.has(v)).map((alias) => ({ alias, reached: false, planned: true, subvers: [] }))];
}

/**
 * 一串需求 → 版本 `x.y` → 子版 `x.y.z` 两级分组（未编号的一律归 "(未编号)"）。
 *
 * 两轴模型：**开发形态需求**（id 带开发线段、没有子版号）按**开发线**分组，
 *   线上每条需求自成一格（需求 ≡ 交付单元）——版号不再出现在需求侧。
 */
function groupByVersion(reqs) {
  const byVersion = new Map();
  for (const r of reqs) {
    const devSeg = devLineSegOfId(String(r.id ?? ""));
    if (devSeg) {
      // 开发线：每条需求一格
      if (!byVersion.has(devSeg)) byVersion.set(devSeg, new Map());
      const subs = byVersion.get(devSeg);
      const key = String(r.id ?? "");
      if (!subs.has(key)) subs.set(key, []);
      subs.get(key).push(r);
      continue;
    }
    const sub = /^\d+\.\d+\.\d+$/.test(r.subver ?? "") ? r.subver : "(未编号)";
    const ver = sub === "(未编号)" ? sub : sub.split(".").slice(0, 2).join(".");
    if (!byVersion.has(ver)) byVersion.set(ver, new Map());
    const subs = byVersion.get(ver);
    if (!subs.has(sub)) subs.set(sub, []);
    subs.get(sub).push(r);
  }
  const keySort = ([a], [b]) => (a === "(未编号)" ? 1 : b === "(未编号)" ? -1 : a.localeCompare(b, "en", { numeric: true }));
  return [...byVersion.entries()].sort(keySort).map(([alias, subs]) => {
    const subvers = [...subs.entries()]
      .sort(keySort)
      .map(([subAlias, list]) => ({ alias: subAlias, reqs: list, reached: list.length > 0 && list.every((r) => r.status === "done") }));
    return { alias, reached: subvers.length > 0 && subvers.every((v) => v.reached), subvers };
  });
}

/** 渲染 markdown（不含标记；`renderBoardBlock` 负责包裹） */
export function renderBoardView(board, facts, { now = new Date() } = {}) {
  const out = [];
  out.push(`**板**：\`${board.id}\`（${board.name ?? "-"}）· 模式 ${board.mode} · 执行体 ${board.executors.map((e) => e.id).join(" / ")}`);
  out.push("");

  // 里程碑
  out.push("### 里程碑");
  if (facts.milestones.length === 0) out.push("（暂无——`gd milestone add \"<名称>\" --target <YYYY-MM-DD>`）");
  else {
    out.push("| 里程碑 | 别名 | 目标 | 开发线 | 需求进度 | 状态 |");
    out.push("|---|---|---|---|---|---|");
    for (const m of facts.milestones) {
      const alias = m.alias ? `${m.alias}` : "—";
      const prog = m.reqs_total ? `${m.reqs_done ?? 0}/${m.reqs_total}` : "—";
      // 开发线：新模型卡 = 线段（`1a`）；存量卡 = 它的版号标签（历史事实，只读）
      const devSeg = devLineSegOf(m) || "";
      const ver = devSeg || milestoneVerLabel(m) || "—";
      out.push(`| ${m.id} ${m.name} | ${alias} | ${m.target} | ${ver} | ${prog} | ${M_STATUS_ZH[m.status] ?? m.status} |`);
    }
  }
  out.push("");

  // 需求线（存量按子版号派生 · 新模型按开发线段派生）——**每条线一个块**（0.21.7）：
  //   两会话各刷自己那条线的块（`--write --version` / `--line`），diff 不重叠 ⇒ git 层面不互相覆盖。
  const tree = deriveVersionTree(facts);
  out.push("### 需求线");
  const flatVersions = tree.flatMap((t) => t.versions.map((v) => ({ ...v, milestone: t.milestone })));
  const closed = closedOf(facts.subvers ?? []);
  const byVersion = new Map();
  for (const v of flatVersions) {
    if (!byVersion.has(v.alias)) byVersion.set(v.alias, []);
    byVersion.get(v.alias).push(v);
  }
  if (byVersion.size === 0) out.push('（暂无——需求随开发线登记：`gd req new "<标题>" --board --line 1a`）');
  for (const alias of [...byVersion.keys()].sort((a, b) => (a === "(未编号)" ? 1 : b === "(未编号)" ? -1 : a.localeCompare(b, "en", { numeric: true })))) {
    const { begin, end } = versionBlockMarker(alias);
    out.push(begin);
    out.push("| 里程碑 | 线 | 需求线 | 需求 | 状态 | 结版 |");
    out.push("|---|---|---|---|---|---|");
    for (const v of byVersion.get(alias)) {
      // 尚未排活的版本：占一行「未排活」——里程碑有版号但还没建需求（不是欠账）
      if (v.subvers.length === 0) {
        out.push(`| ${v.milestone} | ${v.alias} | — | — | 未排活 | — |`);
        continue;
      }
      for (const sv of v.subvers) {
        const ids = sv.reqs.map((r) => r.id).join(" / ");
        const anyDoing = sv.reqs.some((r) => r.status === "in_progress");
        const state = sv.reached ? "已完成" : anyDoing ? "进行中" : "未开始";
        const record = closed(sv.alias);
        const closedCell = record ? `已结版 ${record.reached_on}` : sv.reached ? "待结版" : "—";
        out.push(`| ${v.milestone} | ${v.alias} | ${sv.alias} | ${ids} | ${state} | ${closedCell} |`);
      }
    }
    out.push(end);
    out.push("");
  }
  out.push("");

  // 对外版本（发布轴 · 两轴模型）：版本号只在这里出现
  out.push("### 对外版本（发布轴）");
  const rels = facts.releases ?? [];
  if (rels.length === 0) out.push('（暂无——`gd release new "<名称>"` 开一条对外版本）');
  else {
    out.push("| 版本 | 状态 | 成员需求 | 需求完成 | tag |");
    out.push("|---|---|---|---|---|");
    for (const r of rels) {
      const done = r.reqs_done === null || r.reqs_done === undefined ? "—" : `${r.reqs_done}/${r.reqs_total}`;
      out.push(`| ${r.version} | ${r.status} | ${(r.reqs ?? []).join(" / ") || "—"} | ${done} | ${r.tag || "—"} |`);
    }
  }
  out.push("");

  // 需求
  out.push("### 需求");
  if (facts.reqs.length === 0) out.push("（暂无——`gd req new \"<标题>\" --board`）");
  else {
    out.push("| 需求 | 线 | 标题 | 状态 | 任务（完成/总） |");
    out.push("|---|---|---|---|---|");
    for (const r of facts.reqs) {
      const c = facts.reqCounts.get(r.id) ?? { done: 0, total: 0 };
      const line = r.subver || devLineSegOfId(String(r.id ?? "")) || "—";
      out.push(`| ${r.id} | ${line} | ${r.title} | ${STATUS_ZH[r.status] ?? r.status} | ${c.done}/${c.total} |`);
    }
  }
  out.push("");

  // 未完成任务（按状态分组，不做优先级推断）
  const open = facts.tasks.filter((t) => t.status !== "done");
  out.push("### 未完成任务");
  if (open.length === 0) out.push("（没有未完成任务）");
  else {
    out.push("| 任务 | 标题 | 状态 | 负责人 | 占用 |");
    out.push("|---|---|---|---|---|");
    const order = { in_progress: 0, review: 1, ready: 2 };
    for (const t of [...open].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.id.localeCompare(b.id))) {
      const occupying = ledgerBlock(t.claim);
      const claim = occupying?.session ? `${occupying.session}${occupying.host ? "@" + occupying.host : ""}` : "—";
      out.push(`| ${t.id} | ${t.title} | ${STATUS_ZH[t.status] ?? t.status} | ${t.executor || "—"} | ${claim} |`);
    }
  }
  out.push("");
  out.push(
    `> 本块由 \`gd core roadmap --write\` 从板账重算（${now.toISOString().slice(0, 16).replace("T", " ")}）。**账是真相，本视图可随时重算**；手改本块会在下次重算时被覆盖。`
  );
  return out.join("\n");
}

/** 包成带标记的块（幂等：重复渲染结果相同，只有时间戳行会变） */
export function renderBoardBlock(board, facts, opts = {}) {
  return [VIEW_BEGIN, "", renderBoardView(board, facts, opts), "", VIEW_END].join("\n");
}

/**
 * 把派生块里的**生成时间**抹成固定占位（只用于「值不值得写盘」的比较，永不落盘）。
 *
 * 为什么需要：视图尾行带生成时间戳 ⇒ 每次重算都必然产生一行 diff，哪怕账一个字没变。
 *   于是 git 有没有改动的信号被废掉 —— 分不出「板账变了」和「只是又跑了一次 --write」。
 * 取舍：**时间戳保留**（它回答「这视图是什么时候算的」），但**内容没变就不写盘** ——
 *   写盘本身才是产生 diff 的动作；不写，文件保持原样，时间戳也停在「内容最后一次变化」那一刻。
 */
function stripGeneratedAt(text) {
  return String(text ?? "").replace(/（\d{4}-\d{2}-\d{2} \d{2}:\d{2}）/, "（<generated-at>）");
}

/**
 * 把派生块写进 `<repo>/roadmap.md`：有标记 ⇒ 只替换标记之间；无标记 ⇒ 追加到文末（不覆盖人手写的内容）。
 * **内容没变（抹掉生成时间后）就不写盘** —— 见 `stripGeneratedAt`：不写才没有 diff。
 * @returns {{ok: boolean, path: string, mode: "replaced"|"appended"|"unchanged", error?: string}}
 */
/** 单个版本块的标记（0.21.7：每版本一块 ⇒ 两会话各刷各的，diff 不重叠） */
export function versionBlockMarker(alias) {
  return { begin: `<!-- gd:board-view:version:${alias}:begin -->`, end: `<!-- gd:board-view:version:${alias}:end -->` };
}

/** 原子写：先写临时文件再 rename——并发写不会出现半截内容（Windows 上 rename 覆盖是原子的） */
function writeFileAtomicText(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}

/** 顶行兜底版本号 `版本号: x.y.z`（只认**行首**三段式，并捕获前缀以保留书写格式） */
const VERSION_LINE_RE = /^(版本号[:：][ \t]*)([0-9]+\.[0-9]+\.[0-9]+)/m;

/**
 * 刷新 roadmap.md 顶行的兜底版本号 → 板账里**最新已结版**子版。
 * 为什么要跟 `--write` 一起刷（0.23.0 R-gm-050）：本行是「无板时兜底」，有板时它就是结版事实的镜像；
 *   以前靠人手改，结果停在 0.21.0（板上已 0.21.15）——派生视图就不该留手维护的派生值。
 * 总控本仓 0.28.5 起已删这行 ⇒ 这里**不再新建**（只就地替换），日常跑就是 no-op；
 *   留着是为了「有人把行加回来时它不会静默变陈旧」。
 * @returns {{text: string, stamped: string|null}} stamped = 实际写入的版本（无该行/无已结版 ⇒ null）
 */
function stampVersionLine(text, boardRoot) {
  const latest = latestClosedSubver(readSubvers(boardRoot).list ?? []);
  if (!latest || !VERSION_LINE_RE.test(text)) return { text, stamped: null };
  return { text: text.replace(VERSION_LINE_RE, (_, head) => `${head}${latest}`), stamped: latest };
}

/**
 * 把派生块写进 `<repo>/roadmap.md`。
 * @param {string} text 完整派生块（外层标记已包含）
 * @param {{version?: string|null}} [opts] 传 `version` 时**只替换该版本块**（其余块原样保留）
 */
export function writeBoardBlock(board, text, { version = null } = {}) {
  const repo = board.repo && String(board.repo).trim() ? String(board.repo) : board.root;
  const path = join(repo, "roadmap.md");
  // 文件不在 ⇒ 当空文件处理（新仓首次 --write 直接落地，不必先手工建一份 roadmap.md）
  const raw = existsSync(path) ? readFileSync(path, "utf8") : "";
  // 顶行兜底版本号随写刷新（两种模式都刷：它不属任何版本块）
  const { text: cur, stamped } = stampVersionLine(raw, board.root);

  // ① 按版本局部刷新：只换该版本那一块（外层派生块与其它版本块不动）
  if (version) {
    const { begin, end } = versionBlockMarker(version);
    const nb = text.indexOf(begin);
    const ne = text.indexOf(end);
    const ob = cur.indexOf(begin);
    const oe = cur.indexOf(end);
    if (nb < 0 || ne < 0) return { ok: false, path, mode: "replaced", error: `派生块里没有版本 ${version} 的分块（该版本无需求？）` };
    if (ob < 0 || oe < ob) return { ok: false, path, mode: "replaced", error: `roadmap.md 里没有版本 ${version} 的标记块——先全量 --write 一次建立结构` };
    const slice = text.slice(nb, ne + end.length);
    const before = cur.slice(ob, oe + end.length);
    // 内容（抹掉生成时间后）没变 ⇒ **不写盘**：不写才没有 diff（时间戳本身不构成「变化」）
    if (stripGeneratedAt(before) === stripGeneratedAt(slice)) {
      return { ok: true, path, mode: "unchanged", scope: `version:${version}`, stamped };
    }
    writeFileAtomicText(path, cur.slice(0, ob) + slice + cur.slice(oe + end.length));
    return { ok: true, path, mode: "replaced", scope: `version:${version}`, stamped };
  }

  // ② 全量：替换外层派生块；没有就追加
  const b = cur.indexOf(VIEW_BEGIN);
  const e = cur.indexOf(VIEW_END);
  if (b >= 0 && e > b) {
    const before = cur.slice(b, e + VIEW_END.length);
    if (stripGeneratedAt(before) === stripGeneratedAt(text)) {
      return { ok: true, path, mode: "unchanged", stamped };
    }
    writeFileAtomicText(path, cur.slice(0, b) + text + cur.slice(e + VIEW_END.length));
    return { ok: true, path, mode: "replaced", stamped };
  }
  const sep = cur.endsWith("\n") ? "\n" : "\n\n";
  writeFileAtomicText(path, cur + sep + text + "\n");
  return { ok: true, path, mode: "appended" };
}

/** 汇总口径（--json 用；与视图同源，避免两套统计） */
export function boardViewSummary(facts) {
  const tasks = { total: facts.tasks.length };
  for (const t of facts.tasks) tasks[t.status] = (tasks[t.status] ?? 0) + 1;
  const tree = deriveVersionTree(facts);
  const versions = tree.flatMap((t) => t.versions);
  const flatSubvers = versions.flatMap((v) => v.subvers);
  const closedCount = (facts.subvers ?? []).filter((x) => flatSubvers.some((sv) => sv.alias === x.alias)).length;
  return {
    milestones: facts.summary,
    versions: versions.length,
    subversions: flatSubvers.length,
    subversions_closed: closedCount,
    reqs: facts.reqs.length,
    tasks,
  };
}

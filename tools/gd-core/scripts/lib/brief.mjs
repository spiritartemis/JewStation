/**
 * brief —— 进度简报的**取数与折叠**（core 层 · **只读** · 0.49.1 R-gm-49-1）
 *
 * 为什么要有它：查进度是「几乎每次开工前的第一步」，但原先只能多点探查。实测一次完整探查 =
 *   **48 次命令 / 约 48 KB 输出 / 2-3 分钟**（还夹着两次全量门禁与一次误写）。本模块把
 *   「一次全板取数 → 折叠 → 五段投影」收成一条命令的数据源（`gd brief`）。
 *
 * 三条硬约束（写进 `core-brief-e2e` 断言，不靠自觉）：
 *   ① **零写**：只读盘，不写账、不改文件、不重算派生视图（`roadmap --write` 是另一件事）。
 *   ② **不跑门禁**：门禁属「收工面」，本模块不启动任何子进程（唯一例外是可选的**一次**
 *      `git status --porcelain --branch`，`--no-git` 可关），也**不在输出里代为点名**——要跑哪条门禁
 *      看 AGENTS.md §2，简报只报事实。
 *   ③ **无假字段**：拿不到的事实**整项不输出**，绝不用 0 / null 冒充。反面教材：
 *      `gd board --json` 的 `unpushed` 曾恒为 0（默认值写在展开前，快照里没有该键 ⇒ 永不覆盖）。
 *
 * 折叠口径（「一屏能看」的关键）：鸟瞰**一行一张里程碑**（`标记 id · 别名 · 定位 · 需求 done/总`，
 *   不用竖线、列按显示宽度对齐，版号不进表），段首一行给全板三组计数；已达成超出
 *   `MAX_REACHED_ROWS` 张时**优先隐藏结版时间最早的**，折掉几张在段首下一行点名。
 *   不展开需求 id / 子版，`--full` 才展开全部。
 *   「上次」只留最近 `RECENT_ROWS` 条、每条一行（时间 / 对象 / 事件 / 说明，无表头行），
 *   并排在**最末一段**——流水账越长越没人看。
 *
 * 与 `boardSnapshot`（`lib/board.mjs`）的关系：**同源基元、不同投影**。这里自己组装，是因为
 *   brief 需要 `claim` / `work_unit`（谁此刻在干），而 `boardSnapshot` 的投影把它们丢掉了；
 *   给它加字段会让 `gd board --json`（现 652 KB）再涨，得不偿失。两者的读基元完全一致
 *   （`readReqEntries` / `readAllLedgers` / `readAllEvents`），口径不会分叉。
 */
import { spawnSync } from "node:child_process";
import { readAllEvents, readAllLedgers, readReqEntries } from "./board.mjs";
import { readLanes } from "./lanes.mjs";
import { readLines } from "./lines.mjs"; // 两轴模型：开发线归属
import { devLineSegOfId } from "./reqid.mjs"; // 两轴模型：需求 id 里的开发线段
import { milestoneVersions, milestonesView, readMilestones, REQ_DONE_STATUSES } from "./milestones.mjs";
import { readSubvers } from "./subvers.mjs";
import { countTasks } from "./taskstates.mjs";
import { claimOf, isClaimExpired, sessionIdFromEnv } from "./workclaim.mjs";
import { out } from "./style.mjs";

/** 契约版本：字段增删要升它（外部消费方按版本判断） */
export const BRIEF_VERSION = 1;

/** 可单取的段（`--section`）：顺序即渲染顺序 */
export const BRIEF_SECTIONS = ["coords", "map", "next", "drift", "recent"];

/** 「上次」段最多几条（流水账越长越没人看） */
export const RECENT_ROWS = 3;
/** 文本档的预算（e2e 硬断言）：中文 3 字节/字，2048 字节装不下一屏 ⇒ 实测口径 */
export const TEXT_BUDGET = { lines: 34, chars: 1700, bytes: 4600 };
/** JSON 档的预算 */
export const JSON_BUDGET = 16384;

// ── 小工具 ────────────────────────────────────────────────
const SUBVER_RE = /^\d+\.\d+\.\d+$/;
/** 子版号（形态不对一律当「未编号」）——与 roadmap 派生同口径 */
const subverOf = (v) => (SUBVER_RE.test(String(v ?? "")) ? String(v) : null);
/** 子版 → 版本 `x.y` */
const verOf = (sub) => (sub ? sub.split(".").slice(0, 2).join(".") : null);
/** 依赖边元素 → id（读侧归一有两种形态：字符串 / {id}） */
const depIdOf = (d) => (typeof d === "string" ? d : String(d?.id ?? ""));
/** 显示宽度（全角汉字占两列）——按字符数补空格会让表格错位 */
const dispWidth = (s) =>
  [...String(s ?? "")].reduce(
    (n, ch) => n + (/[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1),
    0,
  );
/** 按显示宽度右侧补空格（表格对齐用） */
const padTo = (s, w) => String(s ?? "") + " ".repeat(Math.max(0, w - dispWidth(s)));
/** 各列显示宽度（取所有行里的最大值） */
const colWidths = (rows) => Array.from({ length: rows[0]?.length ?? 0 }, (_, i) => Math.max(0, ...rows.map((r) => dispWidth(r[i] ?? ""))));
/**
 * 一行多列（按显示宽度对齐）。末列不补空格（补了就是行尾空白）；末列为空就整列不出。
 * @param {string[]} cells
 * @param {number[]} widths
 * @param {{dim?: number[]}} [opts] 需要暗色显示的列序号
 */
function alignRow(cells, widths, { dim = [] } = {}) {
  const parts = [];
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i];
    if (i === cells.length - 1 && v === "") continue;
    const padded = i === cells.length - 1 ? v : padTo(v, widths[i]);
    parts.push(dim.includes(i) ? out.dim(padded) : padded);
  }
  return parts.join("  ");
}
/** 截断（中文按字计；超长补省略号） */
const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, Math.max(0, n - 1))}…`;
};
/** 版本号比较（数字段；`(未编号)` 排最后） */
const cmpVer = (a, b) => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

/**
 * 一次 git 调用拿「未推送 / 脏文件」两件事（`--porcelain --branch` 的首行就带 ahead）。
 * 拿不到（非 git 仓 / 无 git / 超时）⇒ **返回 null**，上层整项不输出。
 */
function gitFacts(repo, enabled) {
  if (!enabled || !repo) return null;
  let r;
  try {
    r = spawnSync("git", ["-C", String(repo), "status", "--porcelain", "--branch"], { encoding: "utf8", timeout: 4000 });
  } catch {
    return null;
  }
  if (r?.status !== 0 || typeof r.stdout !== "string") return null;
  const lines = r.stdout.split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = lines.find((l) => l.startsWith("## ")) ?? "";
  const dirty = lines.filter((l) => !l.startsWith("## ")).length;
  const aheadMatch = /ahead (\d+)/.exec(head);
  const behindMatch = /behind (\d+)/.exec(head);
  return {
    branch: head.replace(/^## /, "").split("...")[0].split(" ")[0] || null,
    has_upstream: head.includes("..."),
    ahead: aheadMatch ? Number(aheadMatch[1]) : null, // 无 upstream ⇒ null（不是 0）
    behind: behindMatch ? Number(behindMatch[1]) : null,
    dirty,
  };
}

/**
 * 全板取数（**一次**读盘，五段共用）。
 * @param {{root: string, board: object, now?: number, git?: boolean}} o
 */
export function collectFacts({ root, board, now = Date.now(), git = true }) {
  const entries = readReqEntries(root); // 需求索引：title / status / subver / depends_on
  const ledgers = readAllLedgers(root); // 任务账：含 claim / artifacts / review（boardSnapshot 会丢 claim）
  const events = readAllEvents(root); // 全板事件（recent 用；已按 at+seq 排序）
  const msRaw = readMilestones(root);
  const svRaw = readSubvers(root);
  const laneRaw = readLanes(root);

  const reqs = entries.map((e) => {
    const ledger = ledgers.get(String(e.id)) ?? { tasks: [] };
    const tasks = (ledger.tasks ?? []).map((t) => ({
      id: String(t.id ?? ""),
      title: String(t.title ?? ""),
      status: String(t.status ?? ""),
      executor: String(t.executor ?? ""),
      depends_on: (t.depends_on ?? []).map(depIdOf),
      claim: claimOf(t),
      artifacts: t.artifacts ?? [],
      review: t.review ?? null,
      created: String(t.created ?? ""), // 「上次」回退用：事件流空时靠它给一行
      req: String(e.id),
    }));
    return {
      id: String(e.id),
      title: String(e.title ?? ""),
      status: String(e.status ?? ""), // 账面存量态（派生态由任务算）
      subver: subverOf(e.subver),
      kind: String(e.kind ?? "feature"),
      severity: String(e.severity ?? ""),
      depends_on: (e.depends_on ?? []).map(depIdOf),
      tasks,
      counts: countTasks(tasks),
    };
  });
  const reqById = new Map(reqs.map((r) => [r.id, r]));
  const tasks = reqs.flatMap((r) => r.tasks.map((t) => ({ ...t, subver: r.subver, ver: verOf(r.subver) })));

  // 里程碑派生（reqs_done 用**需求派生态**，不用账面存量态——两者在板上会不同步）
  const reqStatusById = Object.fromEntries(reqs.map((r) => [r.id, r.status]));
  const msView = milestonesView(msRaw.ok ? msRaw.list : [], now, { reqStatusById });

  const closedSubvers = new Set((svRaw.ok ? svRaw.list : []).filter((s) => s.reached_on).map((s) => String(s.alias)));
  const laneByVer = new Map((laneRaw.ok ? laneRaw.list : []).map((l) => [String(l.version), l]));
  // 两轴模型：开发线归属（开发轴的并行隔离坐标）
  const lineRaw = readLines(board.root);
  const lineBySeg = new Map((lineRaw.ok ? lineRaw.list : []).map((l) => [String(l.line), l]));

  return {
    board,
    root,
    now,
    session: sessionIdFromEnv(),
    reqs,
    reqById,
    tasks,
    events,
    milestones: msView.items,
    milestonesError: msRaw.ok ? null : msRaw.error,
    closedSubvers,
    laneByVer,
    lineBySeg,
    lanesError: laneRaw.ok ? null : laneRaw.error,
    git: gitFacts(board?.repo ?? root, git),
  };
}

// ── 段 ①：坐标（我在哪）────────────────────────────────────
/**
 * 五级降级定位：**持有占用 > 待你验收 > 可开工 > 活跃里程碑首个未结版子版**。
 * 判据不猜：每一级都来自账（claim / review / ready / subvers）。
 */
function coordsOf(f) {
  const { now, session } = f;
  const liveClaim = (t) => t.claim && !isClaimExpired(t.claim, { now });
  const mine = f.tasks.filter((t) => liveClaim(t) && (t.claim.session === session || !t.claim.session));
  const reviews = f.tasks.filter((t) => t.status === "review");
  const doneIds = new Set(f.tasks.filter((t) => t.status === "done").map((t) => t.id));
  const ready = f.tasks.filter((t) => t.status === "ready" && t.depends_on.every((d) => doneIds.has(d)));
  const active = f.milestones.filter((m) => m.status === "in_progress");
  const activeSub = active
    .flatMap((m) => milestoneVersions(m))
    .flatMap((v) => f.reqs.filter((r) => verOf(r.subver) === v).map((r) => r.subver))
    .filter((s) => s && !f.closedSubvers.has(s))
    .sort(cmpVer)[0] ?? null;

  let task = mine[0] ?? null;
  if (!task && reviews.length > 0) task = reviews[0];
  if (!task && ready.length > 0) task = [...ready].sort((a, b) => cmpVer(a.subver, b.subver) || a.id.localeCompare(b.id))[0];
  let req = task ? f.reqById.get(task.req) ?? null : null;
  if (!req) {
    // 没有可干的任务时，坐标退到「需求级」：活跃里程碑中最早未结版的子版里的未完成需求
    req = f.reqs
      .filter((r) => !REQ_DONE_STATUSES.has(r.status))
      .filter((r) => !r.subver || !f.closedSubvers.has(r.subver))
      .sort((a, b) => cmpVer(a.subver, b.subver) || a.id.localeCompare(b.id))[0] ?? null;
  }
  if (!req && activeSub) req = f.reqs.find((r) => r.subver === activeSub) ?? null;

  const subver = req?.subver ?? activeSub ?? null;
  const ver = verOf(subver);
  // 里程碑归属：先看「需求挂在哪张里程碑的 reqs 里」，没有再看版本归属（未挂里程碑的需求也能定位）
  const msOf = (rid, v) =>
    f.milestones.find((m) => (m.reqs ?? []).includes(rid)) ??
    (v ? f.milestones.find((m) => m.status === "in_progress" && milestoneVersions(m).includes(v)) ?? null : null);
  const milestone = msOf(req?.id, ver) ?? active[0] ?? null;
  const lane = ver ? f.laneByVer.get(ver) ?? null : null;
  const subTasks = subver ? f.reqs.filter((r) => r.subver === subver) : [];
  // 两轴模型：开发形态需求的坐标落在**开发线**上（id 里的线段），没有子版号
  const devSeg = req ? devLineSegOfId(String(req.id ?? "")) : "";
  const devOwner = devSeg ? (f.lineBySeg?.get(devSeg)?.owner ?? null) : null;

  return {
    milestone: milestone
      ? {
          id: String(milestone.id),
          alias: milestone.alias ?? null,
          name: String(milestone.name ?? ""),
          status: String(milestone.status ?? ""),
          target: milestone.target ?? null,
          days_left: milestone.days_left ?? 0,
          overdue_days: milestone.overdue_days ?? 0,
        }
      : null,
    // 两轴模型：开发形态需求没有版本坐标 ⇒ 坐标里的「版本」槽改放**开发线段**（子版槽留空）
    version: ver
      ? { alias: ver, claimed_by: lane?.owner ?? null, is_mine: lane?.owner === f.session || lane?.owner === "local" }
      : devSeg
        ? { alias: devSeg, claimed_by: devOwner ?? null, is_mine: devOwner === f.session || devOwner === "local", is_line: true }
        : null,
    subver: subver
      ? {
          alias: subver,
          closed: f.closedSubvers.has(subver),
          reqs_done: subTasks.filter((r) => REQ_DONE_STATUSES.has(r.status)).length,
          reqs_total: subTasks.length,
        }
      : null,
    req: req ? { id: req.id, title: req.title, status: req.status, subver: req.subver } : null,
    task: task ? { id: task.id, title: task.title, status: task.status, executor: task.executor, held_by_me: liveClaim(task) } : null,
  };
}

// ── 段 ②：鸟瞰（折叠视图）──────────────────────────────────
/** 一个版本 `x.y` 下从需求汇总出的子版集合（子版号挂在需求上，不另建实体） */
function subversOfVersion(f, ver) {
  const list = f.reqs.filter((r) => verOf(r.subver) === ver && r.subver);
  const bySub = new Map();
  for (const r of list) {
    if (!bySub.has(r.subver)) bySub.set(r.subver, []);
    bySub.get(r.subver).push(r);
  }
  return [...bySub.entries()]
    .sort((a, b) => cmpVer(a[0], b[0]))
    .map(([alias, rs]) => ({
      alias,
      closed: f.closedSubvers.has(alias),
      reqs_done: rs.filter((r) => REQ_DONE_STATUSES.has(r.status)).length,
      reqs_total: rs.length,
    }));
}

function mapOf(f, { full = false } = {}) {
  const agg = (list) => {
    const t = list.reduce(
      (a, r) => {
        a.reqs += 1;
        if (REQ_DONE_STATUSES.has(r.status)) a.reqs_done += 1;
        a.tasks += r.counts.total;
        a.tasks_done += r.counts.done;
        return a;
      },
      { reqs: 0, reqs_done: 0, tasks: 0, tasks_done: 0 },
    );
    return t;
  };
  const milestones = f.milestones.map((m) => {
    const ids = Array.isArray(m.reqs) ? m.reqs.map(String) : [];
    const member = ids.map((id) => f.reqById.get(id)).filter(Boolean);
    const base = {
      id: String(m.id),
      alias: m.alias ?? null,
      name: String(m.name ?? ""),
      status: String(m.status ?? ""),
      target: m.target ?? null,
      reached_on: m.reached_on ?? null,
      days_left: m.days_left ?? 0,
      overdue_days: m.overdue_days ?? 0,
      ver: m.ver ?? null,
      reqs_done: member.filter((r) => REQ_DONE_STATUSES.has(r.status)).length,
      reqs_total: member.length,
      missing_reqs: ids.filter((id) => !f.reqById.has(id)),
    };
    // 折叠：已达成且非 --full ⇒ 到此为止（不给版本 / 子版 / 需求明细）
    if (m.status === "reached" && !full) return { ...base, collapsed: true };
    const totals = agg(member);
    const range = milestoneVersions(m);
    const haveVer = new Set(member.map((r) => verOf(r.subver)).filter(Boolean));
    const versions = [...new Set([...haveVer, ...range])]
      .sort(cmpVer)
      .map((ver) => {
        const subs = subversOfVersion(f, ver);
        const inVer = member.filter((r) => verOf(r.subver) === ver);
        const vTotals = agg(inVer);
        return {
          alias: ver,
          planned: !haveVer.has(ver), // 区间里还没排活的位（容量预留，不是欠账）
          status: !haveVer.has(ver) ? "unplanned" : vTotals.reqs > 0 && vTotals.reqs_done === vTotals.reqs ? "done" : "in_progress",
          reqs: vTotals.reqs,
          reqs_done: vTotals.reqs_done,
          tasks: vTotals.tasks,
          tasks_done: vTotals.tasks_done,
          closed: subs.length > 0 && subs.every((s) => s.closed),
          subvers: subs,
        };
      });
    // 契约瘦身：**已全部结版的版本不展开**（它们的子版明细只在 --full 时给）。
    //   实测：m-4 全量展开 11 个版本 × 最多 15 个子版 ⇒ map 段 13 KB，把整个 JSON 顶破预算。
    //   鸟瞰要的是「还剩哪些版本没结版」，已结版只需一个计数。
    const withReqs = versions.filter((v) => v.subvers.length > 0);
    const closedVers = withReqs.filter((v) => v.closed);
    const shown = full ? versions : versions.filter((v) => v.subvers.length === 0 || !v.closed);
    // 未收口的需求明细（`--full` 才渲染；折叠态不带——已达成里程碑的 84 条需求不该进一屏简报）
    const open_reqs = member
      .filter((r) => !REQ_DONE_STATUSES.has(r.status))
      .sort((a, b) => cmpVer(a.subver, b.subver) || a.id.localeCompare(b.id))
      .map((r) => ({ id: r.id, title: r.title, status: r.status, subver: r.subver }));
    return { ...base, collapsed: false, tasks_done: totals.tasks_done, tasks_total: totals.tasks, versions: shown, versions_closed: closedVers.length, versions_total: withReqs.length, open_reqs };
  });
  const all = agg(f.reqs);
  return {
    totals: {
      reqs: all.reqs,
      reqs_done: all.reqs_done,
      tasks: all.tasks,
      tasks_done: all.tasks_done,
    },
    milestones,
  };
}

// ── 段 ③：上次干到哪儿（事件流倒序 + 按任务合并）────────────
/**
 * 事件流倒序取近 N 条，**同一任务的连续事件合并成一行**。
 * 为什么合并：一次交件会连写 claim / progress×2 / handoff / deliver 五条，逐条列占满一屏却没有信息增量。
 */
function recentOf(f, { limit = RECENT_ROWS } = {}) {
  // 只滤「上下文链接增删」这类纯元数据事件（进账一次、对人零信息）；
  //   `note` **不过滤**——建需求 / 改验收判据都是 note，滤掉会让「刚建完板的第一屏」变成空白。
  const NOISE = new Set(["context", "context-add"]);
  const tail = f.events.filter((e) => !NOISE.has(String(e.kind ?? ""))).slice(-40).reverse();
  const rows = [];
  const seen = new Map(); // task（或本次无 task 时的需求）→ 已归并的那一行
  for (const e of tail) {
    if (rows.length >= limit) break;
    const task = String(e.task ?? "");
    // 无 task 时按**需求**归并：同一条需求的连续事件（note / 状态变更）不该各占一行
    const key = task || String(e.req ?? "") || `${e.kind}:${e.at}`;
    const hit = seen.get(key);
    const line = {
      at: String(e.at ?? ""),
      kind: String(e.kind ?? ""),
      task: task || null,
      req: e.req ? String(e.req) : null,
      state: e.state ? String(e.state) : null,
      text: e.text ? clip(e.text, 60) : null,
      kinds: [String(e.kind ?? "")],
      dup: 1,
    };
    if (hit) {
      // 同一任务/需求：合并（保留最新时间与首个有内容的文本，事件种类累加）
      hit.kinds.push(line.kind);
      hit.dup += 1;
      if (!hit.text && line.text) hit.text = line.text;
      if (!hit.state && line.state) hit.state = line.state;
      continue;
    }
    seen.set(key, line);
    rows.push(line);
  }
  if (rows.length > 0) return rows;
  // 回退：事件流空（新板 / 只建了账还没开工）—— 用任务账上的创建日给一行，
  //   否则「刚建完板的第一屏」在「上次」段是空白，而那恰恰是最需要衔接信息的时刻。
  return f.tasks
    .filter((t) => t.created)
    .sort((a, b) => String(b.created).localeCompare(String(a.created)) || String(b.id).localeCompare(String(a.id)))
    .slice(0, Math.min(3, limit))
    .map((t) => ({
      at: `${t.created}T00:00:00Z`,
      kind: "created",
      task: t.id,
      req: t.req,
      state: t.status,
      text: clip(t.title, 60),
      kinds: ["created"],
      dup: 1,
    }));
}

// ── 段 ④：下一步（表驱动，rank 即优先级）────────────────────
/**
 * 五条规则，顺序即优先级。**不猜、不排期**：每条都只在账上有对应事实时才出现。
 */
function nextOf(f) {
  const { now, session } = f;
  const doneIds = new Set(f.tasks.filter((t) => t.status === "done").map((t) => t.id));
  const depOk = (t) => t.depends_on.every((d) => doneIds.has(d));
  const liveClaim = (t) => t.claim && !isClaimExpired(t.claim, { now });
  const mine = f.tasks.filter((t) => liveClaim(t) && t.claim.session === session && t.status === "in_progress");
  const reviews = f.tasks.filter((t) => t.status === "review");
  const ready = f.tasks
    .filter((t) => t.status === "ready" && depOk(t))
    .sort((a, b) => cmpVer(a.subver, b.subver) || a.id.localeCompare(b.id));
  const blocked = f.tasks.filter((t) => t.status === "ready" && !depOk(t));
  const closedUnclosed = [...new Set(f.reqs.filter((r) => r.subver).map((r) => r.subver))]
    .filter((s) => !f.closedSubvers.has(s))
    .filter((s) => {
      const rs = f.reqs.filter((r) => r.subver === s);
      return rs.length > 0 && rs.every((r) => REQ_DONE_STATUSES.has(r.status));
    })
    .sort(cmpVer);
  const untasked = f.reqs.filter((r) => !REQ_DONE_STATUSES.has(r.status) && r.tasks.length === 0).sort((a, b) => cmpVer(a.subver, b.subver) || a.id.localeCompare(b.id));

  const items = [];
  for (const t of mine.slice(0, 1))
    items.push({ rank: 1, why: "你手上的占用（续作）", target: { kind: "task", id: t.id, title: t.title }, cmd: `gd work start ${t.id}` });
  for (const t of reviews.slice(0, 1))
    items.push({ rank: 2, why: "待你验收", target: { kind: "task", id: t.id, title: t.title }, cmd: `gd check ${t.id} --pass` });
  for (const t of ready.slice(0, 1))
    items.push({
      rank: 3,
      why: blocked.length > 0 ? `可开工（另有 ${blocked.length} 条被依赖卡住）` : "可开工（依赖已满足）",
      target: { kind: "task", id: t.id, title: t.title },
      cmd: `gd work claim ${t.id} && gd work start ${t.id}`,
    });
  for (const s of closedUnclosed.slice(0, 1))
    items.push({ rank: 4, why: "子版待结版（要人拍）", target: { kind: "subver", id: s, title: null }, cmd: `gd ver reach ${s} --confirm ${s}` });
  for (const r of untasked.slice(0, 1))
    items.push({ rank: 5, why: "需求未拆任务", target: { kind: "req", id: r.id, title: r.title }, cmd: `gd task add ${r.id} --task "local:…"` });
  return items.sort((a, b) => a.rank - b.rank).slice(0, 3);
}

// ── 段 ⑤：漂移（机器判据表，每项可机读）────────────────────
/**
 * 一条判据 = 一条数据（`code / level / 命中 / 文案 / 建议命令`）。加判据不改渲染。
 * `level`：warn = 账上有矛盾或可能丢工作；info = 只是提醒（结版要人拍之类）。
 */
const DRIFT_RULES = [
  {
    code: "VER_UNCLAIMED",
    level: "warn",
    hit: (f) => {
      const vers = [...new Set(f.reqs.filter((r) => r.subver && !f.closedSubvers.has(r.subver)).map((r) => verOf(r.subver)))];
      return vers.filter((v) => v && !f.laneByVer.has(v));
    },
    text: (v) => `${v} 未认领版本线，但已有未结版需求`,
    cmd: (v) => `gd ver claim ${v}`,
    idOf: (v) => String(v),
    group: (hits, ids) => `${ids.join(" / ")} 未认领版本线，但都已有未结版需求`,
  },
  {
    code: "REQ_ON_CLOSED_SUBVER",
    level: "warn",
    hit: (f) => f.reqs.filter((r) => r.subver && f.closedSubvers.has(r.subver) && !REQ_DONE_STATUSES.has(r.status)),
    text: (r) => `${r.id} 挂在已结版子版 ${r.subver} 上，但状态仍是「${r.status}」`,
    cmd: (r) => `gd req status ${r.id}`,
    idOf: (r) => r.id,
  },
  {
    code: "REQ_VERSION_IN_RANGE",
    level: "warn",
    hit: (f) => {
      const out = [];
      for (const r of f.reqs) {
        const ver = verOf(r.subver);
        if (!ver) continue;
        const inRange = f.milestones.filter((m) => milestoneVersions(m).includes(ver));
        if (inRange.length === 0) continue;
        if (inRange.some((m) => (m.reqs ?? []).map(String).includes(r.id))) continue;
        out.push({ ...r, _rangeMs: inRange.map((m) => String(m.id)).join("/") });
      }
      return out;
    },
    text: (r) => `${r.id} 的子版 ${r.subver} 落在 ${r._rangeMs} 的版本上，却没挂那张里程碑`,
    cmd: (r) => `gd milestone update ${r._rangeMs.split("/")[0]} --req-add ${r.id}`,
    idOf: (r) => r.id,
    group: (hits, ids) => `${ids.join(" / ")} 的子版落在里程碑区间内却没挂该里程碑（${hits[0]._rangeMs}）`,
  },
  {
    code: "REQ_NO_TASK",
    level: "info",
    hit: (f) => f.reqs.filter((r) => !REQ_DONE_STATUSES.has(r.status) && r.tasks.length === 0),
    text: (r) => `${r.id} 未拆任务（${r.subver ?? "未编号"}）`,
    cmd: (r) => `gd task add ${r.id} --task "local:…"`,
    idOf: (r) => r.id,
    group: (hits, ids) => `${ids.join(" / ")} 未拆任务（状态未终态但零任务）`,
  },
  {
    code: "SUBVER_READY_UNCLOSED",
    level: "info",
    hit: (f) =>
      [...new Set(f.reqs.filter((r) => r.subver).map((r) => r.subver))]
        .filter((s) => !f.closedSubvers.has(s))
        .filter((s) => {
          const rs = f.reqs.filter((r) => r.subver === s);
          return rs.length > 0 && rs.every((r) => REQ_DONE_STATUSES.has(r.status));
        }),
    text: (s) => `子版 ${s} 需求已全验收，待结版（要人拍）`,
    cmd: (s) => `gd ver reach ${s} --confirm ${s}`,
    idOf: (s) => String(s),
  },
  {
    code: "CLAIM_EXPIRED",
    level: "warn",
    hit: (f) => f.tasks.filter((t) => t.claim && isClaimExpired(t.claim, { now: f.now }) && t.status !== "done"),
    text: (t) => `${t.id} 的占用已过期（${t.claim.session}），可直接认领`,
    cmd: (t) => `gd work claim ${t.id}`,
    idOf: (t) => t.id,
  },
  {
    code: "DONE_WITH_CLAIM",
    level: "warn",
    hit: (f) => f.tasks.filter((t) => t.claim && (t.status === "done" || t.status === "review")),
    text: (t) => `${t.id} 已「${t.status}」却仍带占用（${t.claim.session}）`,
    cmd: () => "gd core doctor --fix",
    idOf: (t) => t.id,
  },
  {
    code: "UNPUSHED_COMMITS",
    level: "warn",
    hit: (f) => (f.git?.has_upstream && f.git.ahead > 0 ? [f.git.ahead] : []), // 无 upstream ⇒ 整项不出现
    text: (n) => `主仓 ${n} 个提交未推送`,
    cmd: () => "git push",
    idOf: (n) => String(n),
    single: true,
  },
  {
    code: "DIRTY_MAIN",
    level: "info",
    hit: (f) => (f.git && f.git.dirty > 0 ? [f.git.dirty] : []),
    text: (n) => `主树有 ${n} 个未提交改动`,
    cmd: () => "git status --short",
    idOf: (n) => String(n),
    single: true,
  },
];

/**
 * 每条判据在文本档上渲染成**一行**（同类多条合并成 id 列表）——
 * 否则「两条缺陷没挂里程碑」会占两行，而它本来就是同一条账务矛盾。
 * `group` 缺省用第一条的 text（单条命中时二者等价）。
 */
function driftOf(f) {
  const rows = [];
  for (const rule of DRIFT_RULES) {
    const hits = rule.hit(f) ?? [];
    if (hits.length === 0) continue;
    const shown = hits.slice(0, rule.single ? 1 : 5);
    const items = shown.map((h) => ({ id: rule.idOf(h), text: rule.text(h), cmd: rule.cmd(h) }));
    rows.push({
      code: rule.code,
      level: rule.level,
      count: hits.length,
      text: rule.group ? rule.group(hits, items.map((i) => i.id)) : items[0].text,
      items,
      cmds: [...new Set(items.map((i) => i.cmd))],
      more: Math.max(0, hits.length - shown.length),
    });
  }
  // warn 在前（账上有矛盾的先看），同级按 code 稳定排序
  const lvl = { warn: 0, info: 1 };
  return rows.sort((a, b) => (lvl[a.level] ?? 2) - (lvl[b.level] ?? 2) || a.code.localeCompare(b.code));
}

/**
 * 契约（`gd brief --json` 的正文）。
 * @param {{root: string, board: object, now?: number, full?: boolean, git?: boolean, sections?: string[]}} o
 */
export function buildBrief({ root, board, now = Date.now(), full = false, git = true, sections = BRIEF_SECTIONS }) {
  const f = collectFacts({ root, board, now, git });
  const want = new Set(sections);
  const payload = {
    ok: true,
    brief_version: BRIEF_VERSION,
    generated_at: new Date(now).toISOString(),
    board: {
      id: String(board?.id ?? ""),
      name: board?.name ?? null,
      mode: board?.mode ?? null,
      executors: (board?.executors ?? []).map((e) => String(e.id ?? e)),
    },
    session: f.session,
  };
  if (want.has("coords")) payload.coords = coordsOf(f);
  if (want.has("map")) payload.map = mapOf(f, { full });
  if (want.has("recent")) payload.recent = recentOf(f);
  if (want.has("next")) payload.next = nextOf(f);
  if (want.has("drift")) payload.drift = driftOf(f);
  return { payload, facts: f };
}

// ── 渲染（固定五段：坐标 / 鸟瞰 / 下一步 / 漂移 / 上次）──────────────
/** 「上次」里事件种类的信息量排序（只留前两个） */
const KIND_RANK = ["review", "handoff", "land", "deliver", "dispatch", "progress", "claim"];
/** 鸟瞰里已达成里程碑**最多列几行**（一屏预算）；超出的折成一行提示 */
const MAX_REACHED_ROWS = 4;
/** 鸟瞰行里「定位」一列的最大宽度（里程碑名可能很长，摊开会把行撑成两行） */
const MS_NAME_CLIP = 30;

/**
 * 版本条：**只列还没结版的版本**（已结版汇总成 `+N 已结版`）。
 * 为什么不全列：m-4 横跨 0.40~0.49，全列会把 9 个已结版摊成一行 80 字——鸟瞰要的是「还剩哪些」。
 * `●` = 已结版子版 · `○` = 未结版子版。
 */
function verBar(m) {
  const withReqs = m.versions_total ?? (m.versions ?? []).filter((v) => v.subvers.length > 0).length;
  const closedCount = m.versions_closed ?? 0;
  const open = (m.versions ?? []).filter((v) => v.subvers.length > 0 && !v.closed);
  const unplanned = (m.versions ?? []).filter((v) => v.status === "unplanned").length;
  const parts = open.slice(0, 5).map((v) => `${v.alias} ${v.subvers.slice(0, 6).map((s) => (s.closed ? "●" : "○")).join("")}${v.subvers.length > 6 ? `+${v.subvers.length - 6}` : ""}`);
  if (open.length > 5) parts.push(`…另 ${open.length - 5} 版`);
  if (closedCount > 0) parts.push(`+${closedCount} 已结版`);
  if (unplanned > 0) parts.push(`区间内 ${unplanned} 版未开工`);
  return { text: parts.join("   "), withReqs, closedCount };
}

/**
 * 人读渲染（一屏）。`payload` 缺段就不出那段（`--section` 单取时不会出现空标题）。
 * @param {object} payload `buildBrief().payload`
 * @param {{full?: boolean}} [opts]
 * @returns {string[]}
 */
export function renderBrief(payload, { full = false } = {}) {
  const L = [];
  const c = payload.coords ?? null;
  const ms = c?.milestone ?? null;
  const when = ms ? (ms.overdue_days > 0 ? out.warn(`逾期 ${ms.overdue_days} 天`) : ms.days_left > 0 ? `剩 ${ms.days_left} 天` : "今天到期") : "";
  L.push(out.ok(`📌 ${payload.board.id}${payload.board.name ? `（${payload.board.name}）` : ""}`) + (ms ? ` · ${ms.name}（${ms.id}）· ${when}` : ""));
  L.push("");

  if (c) {
    const chain = [
      c.milestone ? `${c.milestone.id}` : "—",
      c.version ? c.version.alias : "—",
      c.subver ? `${c.subver.alias}${c.subver.closed ? "(已结版)" : "(未结版)"}` : "—",
      c.req ? `${c.req.id}(${c.req.status})` : "—",
      c.task ? `${c.task.id}(${c.task.status})` : "—",
    ];
    L.push(`坐标   ${chain.join(" → ")}`);
    if (c.req) L.push(out.dim(`         ${clip(c.req.title, 56)}`));
    L.push("");
  }

  if (payload.map) {
    // 排序：按里程碑 id 自然序（milestonesView 按 target 排，读起来会 m-1/m-3/m-2 跳）
    const idCmp = (a, b) => String(a.id).localeCompare(String(b.id), "en", { numeric: true });
    const allReached = payload.map.milestones.filter((m) => m.status === "reached");
    const active = payload.map.milestones.filter((m) => m.status !== "reached").sort(idCmp);
    // 折叠口径：**优先隐藏结版时间最早的**——保留最近 MAX_REACHED_ROWS 张（最近走完的几条最能说明「眼下在哪」）。
    //   无 reached_on 的排在最后（老账可能缺字段，不因此被当成「最新」）。
    const reached = allReached
      .slice()
      .sort((a, b) => String(b.reached_on ?? "").localeCompare(String(a.reached_on ?? "")) || idCmp(b, a))
      .slice(0, MAX_REACHED_ROWS)
      .sort(idCmp);
    const folded = allReached.length - reached.length;
    const totals = payload.map.totals;
    // 段名只打一次：有已达成里程碑时挂在它那行；否则挂在第一张进行中的里程碑上。
    //   （曾漏了后者：只有进行中里程碑的板，鸟瞰段没有段名，续行直接以缩进开头——读者找不到这一段）
    let tag = "鸟瞰   ";
    const lab = () => {
      const t = tag;
      tag = "       ";
      return t;
    };
    // 一行一张里程碑：`<标记> id  别名  定位  需求 done/总`——无竖线，列按显示宽度对齐；版号不进表。
    // 段首给全板三组计数——折叠掉的那几张不再是「看不见的黑洞」，数目仍在这一行。
    const msRows = [...reached.map((m) => ({ m, mark: "✅" })), ...active.map((m) => ({ m, mark: "▸" }))];
    const cellsOf = ({ m, mark }) => [`${mark} ${m.id}`, m.alias || "—", clip(m.name || "—", MS_NAME_CLIP), `${m.reqs_done}/${m.reqs_total}`];
    const msWidths = colWidths(msRows.map(cellsOf));
    if (allReached.length + active.length > 0) {
      L.push(
        `${lab()}全板 里程碑 ${allReached.length}/${allReached.length + active.length}   需求 ${totals.reqs_done}/${totals.reqs}   任务 ${totals.tasks_done}/${totals.tasks}`,
      );
    }
    if (folded > 0) L.push(out.dim(`${lab()}+${folded} 张已达成（折叠：优先隐藏结版最早的）`));
    for (const r of msRows) {
      const { m, mark } = r;
      const days = mark === "▸" && m.overdue_days > 0 ? out.warn(`逾期 ${m.overdue_days} 天`) : mark === "▸" && m.days_left > 0 ? `剩 ${m.days_left} 天` : "";
      const extra = mark === "▸" ? ` · 任务 ${m.tasks_done ?? 0}/${m.tasks_total ?? 0}${days ? ` · ${days}` : ""}` : "";
      L.push(`${lab()}${alignRow(cellsOf(r), msWidths)}${extra}`);
      if (mark !== "▸") continue;
      if (m.versions?.length) {
        const bar = verBar(m);
        if (bar.text) L.push(out.dim(`         ${bar.text}`) + (bar.withReqs > 0 ? out.dim(`   版本结版 ${bar.closedCount}/${bar.withReqs}`) : ""));
        if (full) {
          for (const v of m.versions.filter((x) => x.subvers.length > 0)) {
            L.push(out.dim(`           ${v.alias} 需求 ${v.reqs_done}/${v.reqs} · 子版 `) + v.subvers.map((s) => `${s.alias}${s.closed ? "✅" : ""}`).join(","));
          }
        }      }
      if (full && (m.open_reqs ?? []).length > 0) {
        for (const r2 of m.open_reqs) L.push(out.dim(`           ${r2.id} ${r2.subver ?? "—"} ${r2.status}  `) + clip(r2.title, 44));
      }
    }
    if (allReached.length === 0 && active.length === 0) L.push(`${lab()}（账里没有里程碑）`);
    L.push("");  }

  if (payload.next) {
    if (payload.next.length === 0) L.push("下一步 —（没有可推进的任务或子版）");
    else {
      payload.next.forEach((n, i) => {
        const mark = i === 0 ? "①" : i === 1 ? "②" : "③";
        L.push(`下一步 ${mark} ${n.target.id}${n.target.title ? `  ${out.dim(clip(n.target.title, 30))}` : ""}  ${out.dim(`→ ${n.cmd}`)}`);
      });
    }
    L.push("");
  }

  if (payload.drift) {
    if (payload.drift.length === 0) L.push("漂移   ✅ 无");
    else {
      const warn = payload.drift.filter((d) => d.level === "warn");
      const info = payload.drift.filter((d) => d.level !== "warn");
      const shown = warn.slice(0, 4);
      shown.forEach((d, i) => L.push(`${i === 0 ? "漂移   " : "         "}⚠ ${d.text}`));
      const rest = warn.slice(4).map((d) => d.code).concat(info.map((d) => d.code));
      if (rest.length > 0) L.push(out.dim(`         · 另有 ${rest.length} 条：${rest.slice(0, 5).join(" / ")}${rest.length > 5 ? " …" : ""}`));
      const hints = [...new Set(shown.flatMap((d) => d.cmds ?? []))].slice(0, 3);
      if (hints.length > 0) L.push(out.dim(`         建议  ${hints.join("  ·  ")}`));
    }
    L.push("");
  }

  if (payload.recent) {
    if (payload.recent.length === 0) L.push("上次   —（事件流为空）");
    else {
      // 无表头：每条一行，列按显示宽度对齐（时间 / 对象 / 事件 / 说明）。
      const day = (iso) => String(iso ?? "").slice(5, 10);
      const clock = (iso) => String(iso ?? "").slice(11, 16);
      // 事件种类只留最有信息量的两个（一串 claim+progress+handoff+deliver+review 读起来没信息增量）
      const kindsOf = (r) =>
        [...new Set(r.kinds)]
          .sort((a, b) => KIND_RANK.indexOf(a) - KIND_RANK.indexOf(b))
          .slice(0, 2)
          .map((k) => (k === "note" && r.dup > 2 ? `${k}×${r.dup}` : k))
          .join("+");
      const cellsOf = (r) => [`${day(r.at)} ${clock(r.at)}`, clip(r.task ?? r.req ?? "", 26), kindsOf(r), r.text ? clip(r.text, 44) : r.state ?? ""];
      const rows = payload.recent.map(cellsOf);
      const widths = colWidths(rows);
      rows.forEach((cells, i) => L.push(`${i === 0 ? "上次   " : "         "}${alignRow(cells, widths, { dim: [3] })}`));
    }
    L.push("");
  }
  return L;
}

/**
 * work-batch —— 合批前的**撞车预检**（core 层 · 0.45 T-gm-45-0-01 · R-gm-45-0）
 *
 * 要解决的问题：一个工作单元（`req/<需求id>`）一次只合一条分支本来够用，但并行会话多起来之后，
 *   「谁先 land、谁会撞、撞在哪个文件」全靠人猜。猜错的代价是 rebase 到一半才报冲突，
 *   而冲突中间态被 abort 掉 ⇒ 上下文全丢、从零重来。
 *
 * 本模块只做**判定**（跑 git 读事实、不写任何东西），把「谁和谁撞、撞在哪」在动手之前说清：
 *   · `unitChangedFiles`：某条分支相对它的 merge-base 改了哪些文件
 *   · `preflight`：把多个单元 + 主树脏文件放在一起，算出三类重叠
 *
 * **口径：文件级重叠是「可能撞」，不是「一定撞」。** 两个分支改同一个文件的不同段落，
 *   rebase 一样能过。所以措辞必须是「会撞的文件」而不是「冲突」，并且**只提示不阻断** ——
 *   真正的裁判是 git；预检的价值是把「动手之后才知道」提前成「动手之前就看见」。
 *
 * 三类重叠（对应 input 里的 A / B / C）：
 *   A `shared-handwritten`：两个以上单元改了同一个文件 ⇒ **手写事实点**。处置：**单一写入者**——
 *     后 land 的那个先把改动让出去（或 rebase 后重放），绝不两处各改一份。
 *   B `derived`：撞的是机器派生件（`core/closure.json` / `roadmap.md` / `*.index.yaml` …）⇒
 *     正确修法是**重算**不是手工合并。清单见 `DERIVED_PATTERNS`。
 *   C `main-tree`：单元改的文件**主树也脏**（未提交）⇒ 合入会被 git 直接拒
 *     （`Your local changes … would be overwritten by merge`）。处置：等对方提交，或先存档让路。
 */
import { runGitRaw } from "./gitcore.mjs";

/**
 * 机器派生件的识别规则（**撞了不要手工合并，要重算**）。
 * 判据：文件内容完全由仓内其它东西算出来，人改它只是「重新生成」的一种写法。
 */
export const DERIVED_PATTERNS = [
  { re: /^core\/closure\.json$/, why: "core 闭包清单（由 lib/core-closure.mjs 现算）", regen: "node scripts/core-closure-check.mjs --write" },
  { re: /^roadmap\.md$/, why: "版本计划派生视图", regen: "gd core roadmap --write" },
  { re: /(^|\/)capabilities\.index\.yaml$/, why: "producer 能力索引", regen: "gd agent capabilities --index" },
  { re: /\.index\.yaml$/, why: "索引文件", regen: "看该索引的生成命令（entry/ 下各域文档）" },
];

/** 这个文件算不算机器派生件？命中即返回规则 */
export function derivedRuleOf(path) {
  const p = String(path ?? "").split("\\").join("/");
  return DERIVED_PATTERNS.find((r) => r.re.test(p)) ?? null;
}

/**
 * 一条分支相对其基线改了哪些文件（三点 diff：只看分支自己带来的改动）。
 * @param {string} repo 仓目录
 * @param {string} base 基线 ref（如 `main`）
 * @param {string} branch 分支名
 * @returns {string[]}
 */
export function unitChangedFiles(repo, base, branch) {
  const r = runGitRaw(repo, ["diff", "--name-only", `${base}...${branch}`]);
  if (!r.ok) return [];
  return r.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * 合批预检。**只读**：不写盘、不改分支、不 rebase。
 *
 * @param {object} i
 * @param {string} i.repo 仓目录（代码仓）
 * @param {string} i.base 基线 ref
 * @param {Array<{unit:string, branch:string}>} i.units 要一起 land 的单元（按拟合入顺序）
 * @param {string[]} [i.dirty] 主树上**未提交**的已跟踪脏文件（相对仓根）
 * @returns {{
 *   units: Array<{unit:string, branch:string, files:string[]}>,
 *   collisions: Array<{path:string, units:string[], kind:"shared-handwritten"|"derived", rule:object|null}>,
 *   blockedByMainTree: Array<{path:string, units:string[], rule:object|null}>,
 *   ok: boolean,
 * }}
 */
export function preflight(i) {
  const units = (i.units ?? []).map((u) => ({ ...u, files: unitChangedFiles(i.repo, i.base, u.branch) }));

  // A / B：单元之间的文件重叠
  const byPath = new Map();
  for (const u of units) {
    for (const f of u.files) {
      if (!byPath.has(f)) byPath.set(f, []);
      byPath.get(f).push(u.unit);
    }
  }
  const collisions = [];
  for (const [path, owners] of byPath) {
    if (owners.length < 2) continue;
    const rule = derivedRuleOf(path);
    collisions.push({ path, units: owners, kind: rule ? "derived" : "shared-handwritten", rule });
  }
  // 稳定排序：派生件在前（它们有确定的处置方式），其余按路径
  collisions.sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === "derived" ? -1 : 1));

  // C：主树已跟踪的未提交改动 ∩ 单元改的文件 ⇒ 合入必被 git 拒
  const dirtySet = new Set((i.dirty ?? []).map((p) => String(p).split("\\").join("/")));
  const blockedByMainTree = [];
  for (const [path, owners] of byPath) {
    if (!dirtySet.has(path)) continue;
    blockedByMainTree.push({ path, units: owners, rule: derivedRuleOf(path) });
  }
  blockedByMainTree.sort((a, b) => a.path.localeCompare(b.path));

  return { units, collisions, blockedByMainTree, ok: collisions.length === 0 && blockedByMainTree.length === 0 };
}

/**
 * 把预检结果说成人话（CLI 打印用；`--json` 直接给结构）。
 * 措辞纪律：文件级重叠只说**可能撞**，不说「冲突」——真正的裁判是 git。
 * @param {ReturnType<typeof preflight>} p
 * @returns {string[]}
 */
export function preflightLines(p) {
  const lines = [];
  if (p.units.length > 1) {
    lines.push(`合批预检：${p.units.length} 个单元 · 逐个看它们改了哪些文件`);
    for (const u of p.units) lines.push(`  · ${u.unit}（${u.branch}）：${u.files.length} 个文件`);
  }
  if (p.blockedByMainTree.length) {
    lines.push("⚠ 主树有未提交改动，且**正好是这些单元要改的文件** —— 合入会被 git 直接拒：");
    for (const b of p.blockedByMainTree) {
      const who = b.units.length ? `（${b.units.join(" / ")}）` : "";
      lines.push(`  · ${b.path}${who}${b.rule ? `  ← 派生件：${b.rule.why}；正确修法是重算，不是手工合并` : ""}`);
    }
    lines.push("  · 处置：等对方提交 / 让对方存档让路；机器派生件优先「land 后在干净基线上重算」");
  }
  if (p.collisions.length) {
    const shared = p.collisions.filter((c) => c.kind === "shared-handwritten");
    const derived = p.collisions.filter((c) => c.kind === "derived");
    if (shared.length) {
      lines.push("⚠ 以下文件被多个单元同时改动（手写事实点）——**可能撞**，法则是「单一写入者」：");
      for (const c of shared) lines.push(`  · ${c.path}  ← ${c.units.join(" / ")}`);
      lines.push("  · 处置：后 land 的那个先把改动让出去（或 rebase 后重放），不许两处各改一份");
    }
    if (derived.length) {
      lines.push("⚠ 以下文件是**机器派生件**被多个单元同时改 —— 撞了不要手工合并，要重算：");
      for (const c of derived) lines.push(`  · ${c.path}  ← ${c.units.join(" / ")}　（${c.rule.why}；${c.rule.regen}）`);
    }
  }
  if (!p.blockedByMainTree.length && !p.collisions.length) lines.push("✅ 合批预检：没有文件级重叠（不代表一定不冲突——真正的裁判是 git）");
  return lines;
}

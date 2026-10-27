/**
 * capability-cli —— 能力层命令族实现（m-6 · capability-layer · 0.61 R-gm-61-0）
 *
 * 为什么在 lib：完整 CLI（`gd cap`）与 core 面（`gd-core cap`）**共用同一份实现**，且 core 闭包
 *   只允许 `scripts/lib/*.mjs` 与 `scripts/core-*.mjs`（机器守卫 scripts/core-closure-check.mjs）
 *   ⇒ 命令实现放基元桶，域侧（scripts/reqs/cap.mjs）与 core 侧（scripts/core-cap.mjs）都只做薄封装。
 *
 * 用法：
 *   gd cap new "<能力标题>" --id <能力id> [--purpose "…"] [--carrier "kind:定位"…]
 *   gd cap list [--prefix <id前缀>] [--status active|retired] [--json]
 *   gd cap show <能力id> [--json]
 *   gd cap update <能力id> [--title "…"] [--purpose "…"] [--status active|retired] [--carrier "kind:定位"…]
 *
 * 落点：**只落板账**（能力层是 core 层的板上实体；项目账留口不做 —— 详设 §8）。
 * 口径：docs/gd-capability-layer-design.md · entry/workflow/reqflow.md §5.0.3
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "./args.mjs";
import { noBoardMessage, resolveBoardAccount } from "./board-account.mjs";
import { readReqEntries } from "./board.mjs"; // core 口径：只认板（不回落注册项目账）
import { out, errOut } from "./style.mjs";
import {
  CAP_ENTRY_FIELDS,
  CAP_STATUSES,
  createCapability,
  findCapEntry,
  parseCarrierSpec,
  readCapIndex,
  readCapEvents,
  readCapSpec,
  addRequirement,
  fulfillRequirements,
  normalizeReqState,
  parseScenarioSpec,
  removeRequirement,
  updateCapability,
  updateRequirement,
  CAP_REQ_FIELDS,
  writeCapSpec,
  writeCapIndex,
  mergeDeltaIntoCapability,
  readReqBindings,
  writeReqBindings,
  defectsOfCapability,
  mergeStateOf,
  capabilityImpactOf,
  renderDeltaDraft,
} from "./capability-ledger.mjs";
import { bindingProblems, deltaPathOf, parseDelta, renderSpecMarkdown } from "./capability-delta.mjs";

const CAP_USAGE = [
  "gd cap — 能力层（板账 capabilities/）",
  "",
  "  cap new    <能力标题> --id <能力id> [--purpose \"…\"] [--carrier \"kind:定位\"…]",
  "  cap list   [--prefix <id前缀>] [--status active|retired] [--json]",
  "  cap show   <能力id> [--json]",
  "  cap update <能力id> [--title|--purpose|--status|--carrier]（不给字段 = 只做派生态对账）",
  "  cap req    add|update|remove <能力id> [<R#>]（判据写面）",
  "  cap fulfill <能力id> [--req <R#>…] --evidence \"…\"…（判据兑现）",
  "  cap history <能力id> [--json]",
  "  cap bind   <需求id> --capability <能力id> [--delta <路径>] [--role owner|consumer]",
  "  cap draft  <需求id> [--write]（算「碰了哪些能力」并起 delta 草稿 · 草稿不参与合入）",
  "  cap merge  <能力id> --req <需求id> [--dry-run]",
  "  cap export <能力id> [--out <文件>]      cap import <能力id> --file <delta.md> --req <需求id>",
].join("\n");

const KNOWN = {
  new: ["id", "purpose", "carrier"],
  list: ["prefix", "status", "json"],
  show: ["json"],
  update: ["title", "purpose", "status", "carrier", "json"],
  req: ["title", "must", "scenario", "committed-by", "json"],
  bind: ["capability", "role", "delta", "json"],
  merge: ["req", "dry-run", "json"],
  export: ["out", "json"],
  import: ["file", "req", "json"],
  draft: ["write", "json"],
  fulfill: ["req", "evidence", "json"],
  activate: ["req", "evidence", "json"], // 旧名：留在表里只为给改名指路（不入下方可用列表）
  history: ["json"],
};

/** 可用子命令清单（从 KNOWN 派生 —— 新增子命令只改一处；清掉已退役旧名） */
const CAP_SUBCOMMANDS = Object.keys(KNOWN).filter((k) => k !== "activate");

/** `cap req` 的子命令（add / update / remove 共用一条命令族） */
const REQ_SUBS = ["add", "update", "remove"];

/** 需求 id 形态（`R-/B-` + 板 id + 序号段）——`cap draft` 只收这一种入参 */
const REQ_ID_SHAPE = /^[RB]-[a-z0-9]+-[A-Za-z0-9-]+$/;

/**
 * 板账落点（能力层**只落板** —— 项目账留口不做，详设 §8）。
 *
 * 走 core 口径 `lib/board-account.mjs`（只认板，无板即指路，不猜路径）：能力层是 core 层实体，
 *   引 `target-guard`（认板也认注册项目账）等于给 core 留下「回落项目账」的门 —— 机器守卫会红。
 */
function boardOf(argv) {
  const acct = resolveBoardAccount(); // 缺省即板（core 口径）：能力层没有第二本账，不需要任何切板旗标
  if (acct.mode === "none") {
    console.error(errOut.err(noBoardMessage("gd cap", acct)));
    return null;
  }
  if (acct.board?.error) {
    console.error(errOut.err(`✗ 未定位到板：${acct.board.error}`));
    return null;
  }
  return acct.board;
}

/** 未知参数拦截 */
function checkArgs(args, sub) {
  const known = KNOWN[sub] ?? [];
  const bad = Object.keys(args).filter((k) => k !== "_" && !known.includes(k));
  return bad.map((k) => `未知参数 --${k}（gd cap ${sub} 只接受 ${known.map((x) => `--${x}`).join(" / ")}）`);
}

export function runCap(argv) {
  // 裸 `gd cap` / `gd-core cap`：argv 空或首项是空串 ⇒ 直接给用法（以前会抛栈或报「未知子命令 "cap "」）
  const clean = (argv ?? []).filter((a) => typeof a === "string");
  if (clean.length === 0 || clean[0] === "") {
    console.log(CAP_USAGE);
    return 0;
  }
  const args = parseArgs(clean, ["carrier"]);
  const sub = args._[0] ?? "";
  // 分发有两种来法：gd.mjs 传 [sub, ...rest]；直接调用时首项不是子命令名 ⇒ 整体当参数。
  // 子命令集从 KNOWN 派生（一张表：新增子命令只改 KNOWN，不会漏进分发名单）。
  const rest = Object.hasOwn(KNOWN, sub) ? clean.slice(1) : clean;
  const errors = checkArgs(args, sub);

  switch (sub) {
    case "new":
      return capNew(rest, errors);
    case "list":
      return capList(rest, errors);
    case "show":
      return capShow(rest, errors);
    case "update":
      return capUpdate(rest, errors);
    case "req":
      return capReq(rest);
    case "fulfill":
      return capFulfill(rest, errors);
    case "activate": // 0.68.1：改名为 fulfill（旧名不再接受，只指路 —— 未正式外发，别名只会长期活着）
      console.error(errOut.err('✗ `cap activate` 已改名为 `cap fulfill`（判据两态改成 committed / fulfilled）'));
      console.error(`  · 同义：gd cap fulfill ${(rest[0] ?? "<能力id>")} …`);
      return 1;
    case "history":
      return capHistory(rest, errors);
    case "bind":
      return capBind(rest, errors);
    case "merge":
      return capMerge(rest, errors);
    case "export":
      return capExport(rest, errors);
    case "import":
      return capImport(rest, errors);
    case "draft":
      return capDraft(rest, errors);
    default:
      console.error(errOut.err(`✗ 未知子命令 "cap ${sub}"。可用：${CAP_SUBCOMMANDS.join(" / ")}`));
      return 1;
  }
}

function capNew(argv, errors) {
  const args = parseArgs(argv, ["carrier"]);
  const errs = [...errors];
  const title = args._[0];
  const capId = typeof args.id === "string" ? args.id : "";
  if (!title) errs.push('缺少能力标题（gd cap new "<能力标题>" --id <能力id>）');
  if (!capId) errs.push("缺少 --id（能力 id 由人给，不从标题生成）");
  const carriers = [];
  const carrierRaw = Array.isArray(args.carrier) ? args.carrier : args.carrier ? [args.carrier] : [];
  for (const raw of carrierRaw) {
    const r = parseCarrierSpec(raw);
    if (!r.ok) errs.push(r.error);
    else carriers.push(r.carrier);
  }
  const board = boardOf(argv);
  if (!board) return 1;
  if (errs.length > 0) {
    console.error(errOut.err("✗ 参数校验未通过："));
    for (const e of errs) console.error(`  · ${e}`);
    return 1;
  }

  const res = createCapability({
    projDir: board.root,
    capId,
    title,
    purpose: typeof args.purpose === "string" ? args.purpose : "",
    carriers,
    by: board.id,
  });
  if (!res.ok) {
    console.error(errOut.err(`✗ ${res.error}`));
    return 1;
  }
  console.log(out.ok(`✅ 能力已立：${res.capId}（${title}）`));
  console.log(`  板: ${board.id} · 状态: active · 判据: 0 条（未承诺，不阻塞）`);
  console.log(out.dim(`  账: ${board.root}/capabilities/index.yaml · 判据正文: ${board.root}/capabilities/${res.capId}/spec.yaml`));
  console.log(out.dim(`  下一步: gd cap show ${res.capId}   · 判据与合入在 0.62 / 0.63 落地`));
  return 0;
}

function capList(argv, errors) {
  const args = parseArgs(argv);
  const board = boardOf(argv);
  if (!board) return 1;
  if (errors.length > 0) {
    console.error(errOut.err("✗ 参数校验未通过："));
    for (const e of errors) console.error(`  · ${e}`);
    return 1;
  }
  const idx = readCapIndex(board.root);
  let caps = idx.capabilities.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  // 0.68：分类靠 id 自身（req-* / seat-* / contract-* …），用前缀筛，不额外记一份分类字段
  if (typeof args.prefix === "string") caps = caps.filter((c) => String(c.id).startsWith(args.prefix));
  if (typeof args.status === "string") caps = caps.filter((c) => String(c.status) === args.status);
  if (args.json === true) {
    console.log(JSON.stringify({ ok: true, data: { board: board.id, capabilities: caps } }, null, 2));
    return 0;
  }
  if (caps.length === 0) {
    console.log(out.dim(`板 ${board.id}：暂无能力（gd cap new "<标题>" --id <能力id>）`));
    return 0;
  }
  console.log(`板 ${board.id} 的能力（${caps.length} 项）：`);
  for (const c of caps) {
    const n = Number(c.requirements_count ?? 0) || 0;
    console.log(`  ${String(c.id).padEnd(24)} ${String(c.status).padEnd(8)} 判据 ${n} 条  ${c.title}`);
  }
  return 0;
}

function capShow(argv, errors) {
  const args = parseArgs(argv);
  const capId = args._[0];
  const board = boardOf(argv);
  if (!board) return 1;
  if (errors.length > 0 || !capId) {
    console.error(errOut.err("✗ 参数校验未通过："));
    for (const e of errors) console.error(`  · ${e}`);
    if (!capId) console.error("  · 缺少能力 id（gd cap show <能力id>）");
    return 1;
  }
  const idx = readCapIndex(board.root);
  const entry = findCapEntry(idx.capabilities, capId);
  if (!entry) {
    console.error(errOut.err(`✗ 能力 ${capId} 不在目录里（gd cap list 查看）`));
    return 1;
  }
  const spec = readCapSpec(board.root, capId);
  const reqs = spec.requirements ?? [];
  const events = readCapEvents(board.root, capId);

  if (args.json === true) {
    console.log(JSON.stringify({ ok: true, data: { board: board.id, capability: entry, spec, events } }, null, 2));
    return 0;
  }

  console.log(`能力 ${entry.id} · ${entry.title}`);
  console.log(`  状态: ${entry.status} · 创建: ${entry.created} · 判据版本: ${spec.revision ?? 1}`);
  if (entry.purpose && String(entry.purpose).trim()) console.log(`  目的: ${entry.purpose}`);
  console.log(`  判据: ${reqs.length} 条${reqs.length === 0 ? out.warn("（未承诺 —— 不阻塞任何流程）") : ""}`);
  for (const r of reqs) {
    const state = r.state ?? "committed";
    const mark = state === "fulfilled" ? "✅" : "⏳";
    console.log(`  ${mark} ${r.id} ${r.title ?? ""}`);
    if (r.must) console.log(`      MUST: ${r.must}`);
    for (const s of r.scenarios ?? []) {
      console.log(`      · ${s.id ?? ""} ${s.name ?? ""}`);
      if (s.when) console.log(`          WHEN ${s.when}`);
      if (s.then) console.log(`          THEN ${s.then}`);
    }
    if (state === "committed") {
      console.log(out.dim(`      承诺者: ${r.committed_by ?? "（未记）"} · 兑现: 未兑现`));
    } else {
      console.log(out.dim(`      兑现于 ${r.fulfilled_at ?? "?"} · 证据: ${(r.evidence ?? []).join(" / ") || "（无）"}`));
    }
  }
  const carriers = entry.carriers ?? [];
  console.log(`  载体: ${carriers.length === 0 ? out.warn("无载体（还只是口头承诺）") : ""}`);
  for (const c of carriers) {
    const loc = c.uri ?? (c.anchor ? `${c.path}#${c.anchor}` : c.path);
    console.log(`    ${String(c.kind).padEnd(6)} ${loc ?? ""}`);
  }
  // 0.64：反向读 —— 哪些需求在改这项能力（挂点反查）
  const bound = [];
  for (const rid of readReqEntries(board.root).map((e) => String(e?.id ?? "").trim()).filter(Boolean)) {
    let bs = [];
    try {
      bs = readReqBindings(board.root, rid);
    } catch {
      continue;
    }
    const hit = bs.find((b) => String(b.id) === String(capId));
    if (hit) {
      // 0.67：合入状态可查（有 delta 却未合入 = 规范还没长，最容易被忽略的一种「假完成」）
      const st = hit.delta ? mergeStateOf(events, rid) : { merged: false, deltaPaths: [] };
      const state = hit.delta ? (st.merged ? "已合入" : "未合入") : "无 delta";
      bound.push(`${rid}（${hit.role} · ${state}）`);
    }
  }
  console.log(`  在改它的需求: ${bound.length === 0 ? out.dim("（暂无）") : bound.join(" · ")}`);
  // 0.66：挂在这条能力判据上的缺陷（按 capability_ref 反查）
  const defects = defectsOfCapability({ projDir: board.root, capability: capId });
  console.log(`  挂在这条判据上的缺陷: ${defects.length === 0 ? out.dim("（暂无）") : ""}`);
  for (const d of defects) {
    console.log(`    ⌗${d.severity || "?"} ${d.id} ${d.ref.requirement || ""}${d.ref.scenario ? "/" + d.ref.scenario : ""} · ${d.title}`);
  }
  console.log(out.dim(`  事件: ${events.length} 条（合并历史）`));
  return 0;
}

function capUpdate(argv, errors) {
  const args = parseArgs(argv, ["carrier"]);
  const capId = args._[0];
  const board = boardOf(argv);
  if (!board) return 1;
  if (errors.length > 0 || !capId) {
    console.error(errOut.err("✗ 参数校验未通过："));
    for (const e of errors) console.error(`  · ${e}`);
    if (!capId) console.error("  · 缺少能力 id（gd cap update <能力id>）");
    return 1;
  }
  const patch = {};
  if (typeof args.title === "string") patch.title = args.title;
  if (typeof args.purpose === "string") patch.purpose = args.purpose;
  if (typeof args.status === "string") patch.status = args.status;
  const carrierRaw = Array.isArray(args.carrier) ? args.carrier : args.carrier ? [args.carrier] : [];
  if (carrierRaw.length > 0) {
    const carriers = [];
    for (const raw of carrierRaw) {
      const r = parseCarrierSpec(raw);
      if (!r.ok) {
        console.error(errOut.err(`✗ ${r.error}`));
        return 1;
      }
      carriers.push(r.carrier);
    }
    patch.carriers = carriers;
  }
  // 不给任何字段 = 只做**派生态对账**（判据条数缓存 / 版本），不写事件（不是一次「改动」）
  if (Object.keys(patch).length === 0) {
    const idx = readCapIndex(board.root);
    const entry = findCapEntry(idx.capabilities, capId);
    if (!entry) {
      console.error(errOut.err(`✗ 能力 ${capId} 不在目录里（gd cap list 查看）`));
      return 1;
    }
    const spec = readCapSpec(board.root, capId);
    const count = (spec.requirements ?? []).length;
    // 派生态不一致、或条目里还躺着退役字段（0.68：字段白名单之外的键）⇒ 重写一次把账洗平。
    //   这条让 `gd cap update <能力id>` 成为**官方迁移工具**（C8-11 的报错就指路到这里）。
    const extraKeys = Object.keys(entry).filter((k) => !CAP_ENTRY_FIELDS.includes(k));
    // 0.68.1：判据侧也要能靠同一个口洗平 —— 旧态 `activated` 与旧字段 `activated_at` 都在白名单之外；
    //   写一次判据正文（writeCapSpec 内部按白名单净化）它们就自然消失。
    const reqExtraKeys = (spec.requirements ?? []).some((r) => Object.keys(r ?? {}).some((k) => !CAP_REQ_FIELDS.includes(k)));
    const changed =
      Number(entry.requirements_count ?? 0) !== count ||
      Number(entry.revision ?? 1) !== Number(spec.revision ?? 1) ||
      extraKeys.length > 0 ||
      reqExtraKeys;
    if (changed) {
      entry.requirements_count = count;
      entry.revision = Number(spec.revision ?? 1) || 1;
      for (const k of extraKeys) delete entry[k];
      if (reqExtraKeys) writeCapSpec(board.root, capId, spec); // 判据按白名单重写（旧字段消失）
      writeCapIndex(board.root, idx.capabilities);
    }
    const parts = [`判据 ${count} 条`, `版本 ${spec.revision ?? 1}`];
    if (extraKeys.length > 0) parts.push(`清掉退役字段 ${extraKeys.join(" / ")}`);
    else if (!changed) parts.push("缓存本来就一致");
    console.log(out.ok(`✅ 能力已对账：${capId}（${parts.join(" · ")}）`));
    return 0;
  }
  const res = updateCapability({ projDir: board.root, capId, patch, by: board.id });
  if (!res.ok) {
    console.error(errOut.err(`✗ ${res.error}`));
    return 1;
  }
  console.log(out.ok(`✅ 能力已更新：${capId}`));
  console.log(`  ${res.entry.title} · ${res.entry.status} · 判据 ${res.entry.requirements_count} 条`);
  console.log(out.dim(`  账: ${board.root}/capabilities/index.yaml · 事件: ${board.root}/capabilities/${capId}/events.jsonl`));
  return 0;
}

// ── 判据写面（0.62）─────────────────────────────────────────────

/** `cap req add|update|remove <能力id> [<R#>]` */
function capReq(argv) {
  const args = parseArgs(argv, ["scenario", "evidence"]);
  // `cap req` 之后再接一个动作（add / update / remove；缺省 add）
  const words = args._.filter((a) => typeof a === "string");
  const sub = ["add", "update", "remove"].includes(words[0]) ? words[0] : "add";
  const positional = (["add", "update", "remove"].includes(words[0]) ? words.slice(1) : words).filter(
    (a) => !["add", "update", "remove"].includes(a),
  );
  // 位置参数：add ⇒ <能力id>；update / remove ⇒ <能力id> <R#>
  const capId = positional[0] ?? "";
  const reqId = positional[1] ?? "";
  const board = boardOf(argv);
  if (!board) return 1;
  if (!capId) {
    console.error(errOut.err(`✗ 缺少能力 id（gd cap req ${sub} <能力id>${sub === "add" ? "" : " <判据号>"}）`));
    return 1;
  }
  if (sub !== "add" && !reqId) {
    console.error(errOut.err(`✗ 缺少判据号（gd cap req ${sub} ${capId} <R#>）`));
    return 1;
  }

  if (sub === "add") {
    const title = typeof args.title === "string" ? args.title : "";
    const must = typeof args.must === "string" ? args.must : "";
    if (!title || !must) {
      console.error(errOut.err("✗ 判据至少要有 --title 与 --must（一句 MUST）"));
      console.error('  · 场景：--scenario "名称|WHEN|THEN"（可重复；至少一条）');
      return 1;
    }
    const rawScen = Array.isArray(args.scenario) ? args.scenario : args.scenario ? [args.scenario] : [];
    if (rawScen.length === 0) {
      console.error(errOut.err("✗ 至少给一条 --scenario（没有场景的判据不可验证）"));
      return 1;
    }
    const scenarios = [];
    for (let i = 0; i < rawScen.length; i++) {
      const r = parseScenarioSpec(rawScen[i], i + 1);
      if (!r.ok) {
        console.error(errOut.err(`✗ ${r.error}`));
        return 1;
      }
      scenarios.push(r.scenario);
    }
    const res = addRequirement({
      projDir: board.root,
      capId,
      title,
      must,
      scenarios,
      committedBy: typeof args["committed-by"] === "string" ? args["committed-by"] : "",
      by: board.id,
    });
    if (!res.ok) {
      console.error(errOut.err(`✗ ${res.error}`));
      return 1;
    }
    console.log(out.ok(`✅ 判据已加：${capId} / ${res.requirement.id}（${res.requirement.title}）`));
    console.log(`  状态: committed（承诺）· 判据版本: ${res.revision} · 场景 ${res.requirement.scenarios.length} 条`);
    if (!res.requirement.committed_by) console.log(out.dim("  · 未记承诺者（--committed-by <需求id>）——C8 不管，但读面会显示「未记」"));
    console.log(out.dim(`  兑现：gd cap fulfill ${capId} --req ${res.requirement.id} --evidence "…"`));
    return 0;
  }

  if (sub === "update") {
    const patch = {};
    if (typeof args.title === "string") patch.title = args.title;
    if (typeof args.must === "string") patch.must = args.must;
    if (typeof args["committed-by"] === "string") patch.committedBy = args["committed-by"];
    const rawScen = Array.isArray(args.scenario) ? args.scenario : args.scenario ? [args.scenario] : [];
    if (rawScen.length > 0) {
      const scenarios = [];
      for (let i = 0; i < rawScen.length; i++) {
        const r = parseScenarioSpec(rawScen[i], i + 1);
        if (!r.ok) {
          console.error(errOut.err(`✗ ${r.error}`));
          return 1;
        }
        scenarios.push(r.scenario);
      }
      patch.scenarios = scenarios;
    }
    if (Object.keys(patch).length === 0) {
      console.error(errOut.err("✗ 没有要改的字段（--title / --must / --scenario / --committed-by）"));
      return 1;
    }
    const res = updateRequirement({ projDir: board.root, capId, reqId, patch, by: board.id });
    if (!res.ok) {
      console.error(errOut.err(`✗ ${res.error}`));
      return 1;
    }
    console.log(out.ok(`✅ 判据已更新：${capId} / ${reqId} · 判据版本 ${res.revision}`));
    if (res.reopened) console.log(out.warn("  · 正文变了 ⇒ 已兑现状态回 committed（要重新兑现才算数）"));
    return 0;
  }

  const res = removeRequirement({ projDir: board.root, capId, reqId, by: board.id });
  if (!res.ok) {
    console.error(errOut.err(`✗ ${res.error}`));
    return 1;
  }
  console.log(out.ok(`✅ 判据已删：${capId} / ${reqId} · 判据版本 ${res.revision}`));
  console.log(out.dim("  · 号不复用（删掉的 R# 不会再分配给新判据）· 删除已进能力事件流"));
  return 0;
}

/** `cap fulfill <能力id> [--req <R#>…] --evidence "…"…` */
function capFulfill(argv, errors) {
  const args = parseArgs(argv, ["req", "evidence"]);
  const capId = typeof args._[0] === "string" ? args._[0] : "";
  const board = boardOf(argv);
  if (!board) return 1;
  if (errors.length > 0) {
    console.error(errOut.err("✗ 参数校验未通过："));
    for (const e of errors) console.error(`  · ${e}`);
    return 1;
  }
  if (!capId) {
    console.error(errOut.err("✗ 缺少能力 id（gd cap fulfill <能力id> --evidence \"…\"）"));
    return 1;
  }
  const reqIds = Array.isArray(args.req) ? args.req : args.req ? [args.req] : null;
  const ev = Array.isArray(args.evidence) ? args.evidence : args.evidence ? [args.evidence] : [];
  const res = fulfillRequirements({ projDir: board.root, capId, reqIds, evidence: ev, by: board.id });
  if (!res.ok) {
    console.error(errOut.err(`✗ ${res.error}`));
    return 1;
  }
  if (res.idempotent) {
    console.log(out.ok(`✅ 已是兑现态（幂等）：${capId} / ${res.already.join(" / ")}`));
    return 0;
  }
  console.log(out.ok(`✅ 判据已兑现：${capId} / ${res.fulfilled.join(" / ")}`));
  console.log(`  证据 ${ev.length} 条 · 兑现时刻已记入判据（fulfilled_at）`);
  if ((res.already ?? []).length > 0) console.log(out.dim(`  · 本来就已兑现：${res.already.join(" / ")}`));
  return 0;
}

/** `cap history <能力id>` */
function capHistory(argv, errors) {
  const args = parseArgs(argv);
  const capId = typeof args._[0] === "string" ? args._[0] : "";
  const board = boardOf(argv);
  if (!board) return 1;
  if (errors.length > 0 || !capId) {
    console.error(errOut.err("✗ 参数校验未通过："));
    for (const e of errors) console.error(`  · ${e}`);
    if (!capId) console.error("  · 缺少能力 id（gd cap history <能力id>）");
    return 1;
  }
  const events = readCapEvents(board.root, capId);
  if (args.json === true) {
    console.log(JSON.stringify({ ok: true, data: { board: board.id, capability: capId, events } }, null, 2));
    return 0;
  }
  if (events.length === 0) {
    console.log(out.dim(`能力 ${capId}：无事件（还没立出来？gd cap list 查看）`));
    return 0;
  }
  console.log(`能力 ${capId} 的合并历史（${events.length} 条）：`);
  for (const e of events) {
    const at = String(e.at ?? "").replace("T", " ").replace("Z", "");
    const bits = [];
    if (e.state === "created") bits.push("立出");
    else if (e.state === "updated") bits.push("条目更新");
    else if (e.state === "merged") {
      if ((e.added ?? []).length) bits.push(`合入新增 ${e.added.join(",")}`);
      if ((e.modified ?? []).length) bits.push(`合入修改 ${(e.modified ?? []).map((m) => m.id).join(",")}`);
      if ((e.removed ?? []).length) bits.push(`合入删除 ${e.removed.join(",")}`);
      if (e.req) bits.push(`来源需求 ${e.req}`);
      if ((e.delta_paths ?? []).length) bits.push(`delta ${e.delta_paths.join(",")}`);
    } else if (e.state === "req-added") {
      bits.push(`加判据 ${(e.added ?? []).join(",")}`);
      if (e.req) bits.push(`承诺者 ${e.req}`);
    } else if (e.state === "req-updated") {
      bits.push(`改判据 ${(e.modified ?? []).map((m) => m.id).join(",")}`);
      if (e.reopened) bits.push("（已兑现被改回承诺）");
    } else if (e.state === "req-removed") {
      bits.push(`删判据 ${(e.removed ?? []).join(",")}`);
    } else if (e.state === "fulfilled" || e.state === "activated") {
      bits.push(`兑现 ${(e.requirements ?? []).join(",")} · 证据 ${(e.evidence ?? []).length} 条`);
    } else bits.push(e.state ?? "?");
    console.log(`  ${at}  ${bits.join(" · ")}`);
  }
  return 0;
}

// ── 挂点与合入（0.63）────────────────────────────────────────────

/** `cap bind <需求id> --capability <能力id> --delta <路径> [--role owner|consumer]` */
function capBind(argv, errors) {
  const args = parseArgs(argv, ["capability"]);
  const reqId = typeof args._[0] === "string" ? args._[0] : "";
  const board = boardOf(argv);
  if (!board) return 1;
  if (errors.length > 0) {
    console.error(errOut.err("✗ 参数校验未通过："));
    for (const e of errors) console.error(`  · ${e}`);
    return 1;
  }
  if (!reqId) {
    console.error(errOut.err("✗ 缺少需求 id（gd cap bind <需求id> --capability <能力id> [--delta <路径>]）"));
    return 1;
  }
  const capIds = (Array.isArray(args.capability) ? args.capability : args.capability ? [args.capability] : []).filter(
    (x) => typeof x === "string",
  );
  if (capIds.length === 0) {
    console.error(errOut.err("✗ 至少给一个 --capability <能力id>"));
    return 1;
  }
  const role = typeof args.role === "string" ? args.role : "owner";
  const existing = readReqBindings(board.root, reqId);
  const idx = readCapIndex(board.root);
  const existCaps = new Set(idx.capabilities.map((c) => String(c.id)));
  // 多个 --capability 时 delta 只归第一个（owner）；其余按 consumer 挂，delta 留空
  const deltaArg = typeof args.delta === "string" ? args.delta.trim() : "";
  const merged = [...existing];
  capIds.forEach((cid, i) => {
    const b = { id: cid, role: i === 0 ? role : "consumer", delta: i === 0 ? deltaArg : "" };
    const at = merged.findIndex((x) => x.id === cid);
    if (at >= 0) merged[at] = b;
    else merged.push(b);
  });
  const probs = bindingProblems(merged, {
    capExists: (id) => existCaps.has(String(id)),
    deltaExists: (rel) => existsSync(join(board.root, String(rel))),
  });
  if (probs.length > 0) {
    console.error(errOut.err("✗ 挂点不合规："));
    for (const p of probs) console.error(`  · ${p}`);
    return 1;
  }
  const changed = writeReqBindings({ projDir: board.root, reqId, bindings: merged, by: board.id });
  console.log(out.ok(`✅ 需求已挂能力：${reqId} → ${merged.map((b) => `${b.id}(${b.role})`).join(" / ")}`));
  if (!changed) console.log(out.dim("  · 挂点本来就一致（幂等）"));
  const owner = merged.find((b) => b.role === "owner");
  if (owner && owner.delta) console.log(out.dim(`  合入：gd cap merge ${owner.id} --req ${reqId}`));
  else console.log(out.dim("  · 主责能力还没给 delta 文件（--delta reqs/<需求id>/specs/<能力id>.md）——不写 delta 也能挂，只是没有可合入的内容"));
  return 0;
}

/** `cap merge <能力id> --req <需求id> [--dry-run]` */
function capMerge(argv, errors) {
  const args = parseArgs(argv);
  const capId = typeof args._[0] === "string" ? args._[0] : "";
  const board = boardOf(argv);
  if (!board) return 1;
  if (errors.length > 0) {
    console.error(errOut.err("✗ 参数校验未通过："));
    for (const e of errors) console.error(`  · ${e}`);
    return 1;
  }
  const reqId = typeof args.req === "string" ? args.req : "";
  if (!capId || !reqId) {
    console.error(errOut.err("✗ 用法：gd cap merge <能力id> --req <需求id> [--dry-run]"));
    return 1;
  }
  const bindings = readReqBindings(board.root, reqId);
  const hit = bindings.find((b) => String(b.id) === String(capId));
  if (!hit) {
    console.error(errOut.err(`✗ 需求 ${reqId} 没挂能力 ${capId}（先 gd cap bind ${reqId} --capability ${capId} --delta <路径>）`));
    return 1;
  }
  const deltaPath = hit.delta;
  if (!deltaPath) {
    console.error(errOut.err(`✗ 需求 ${reqId} 的 ${capId} 挂点没给 delta 文件（gd cap bind ${reqId} --capability ${capId} --delta reqs/${reqId}/specs/${capId}.md）`));
    return 1;
  }
  const res = mergeDeltaIntoCapability({
    projDir: board.root,
    capId,
    reqId,
    deltaPath,
    by: board.id,
    dryRun: args["dry-run"] === true,
  });
  if (!res.ok) {
    console.error(errOut.err(`✗ 合入被拒：${res.error}`));
    return 1;
  }
  const r = res.result;
  if (r.idempotent) {
    console.log(out.ok(`✅ 已合入过（幂等）：${capId} ← ${reqId}`));
    console.log(out.dim("  · 判据没有重复写；要看合入记录：gd cap history " + capId));
    return 0;
  }
  const bits = [];
  if (r.added.length) bits.push(`新增 ${r.added.join(",")}`);
  if (r.modified.length) bits.push(`修改 ${r.modified.join(",")}`);
  if (r.removed.length) bits.push(`删除 ${r.removed.join(",")}`);
  console.log(out.ok(`✅ ${res.dryRun ? "（预演）" : ""}delta 已合入：${capId} ← ${reqId}`));
  console.log(`  ${bits.join(" · ") || "（无变化）"} · 判据版本 ${res.revision}`);
  console.log(out.dim(`  来源：${deltaPath} · 历史：gd cap history ${capId}`));
  // 0.69：草稿在就在，合入的是正式文件 —— 别让人以为「写了草稿就等于改了规范」
  const draftRel = `reqs/${reqId}/specs/${capId}.md.draft`;
  if (existsSync(join(board.root, draftRel))) {
    console.log(out.warn(`  · 该需求还有草稿未转正：${draftRel}（合入的是正式文件，草稿不参与）`));
  }
  if (!res.dryRun) console.log(out.dim("  · 判据仍为「承诺」态，兑现等需求验收（gd cap fulfill 或验收钩子）"));
  return 0;
}

/** `cap export <能力id> [--out <文件>]` */
function capExport(argv, errors) {
  const args = parseArgs(argv);
  const capId = typeof args._[0] === "string" ? args._[0] : "";
  const board = boardOf(argv);
  if (!board) return 1;
  if (errors.length > 0 || !capId) {
    console.error(errOut.err(`✗ 用法：gd cap export <能力id> [--out <文件>]`));
    return 1;
  }
  const idx = readCapIndex(board.root);
  const entry = findCapEntry(idx.capabilities, capId);
  if (!entry) {
    console.error(errOut.err(`✗ 能力 ${capId} 不在目录里（gd cap list 查看）`));
    return 1;
  }
  const md = renderSpecMarkdown({ capId, entry, spec: readCapSpec(board.root, capId) });
  if (typeof args.out === "string") {
    writeFileSync(args.out, md, "utf8");
    console.log(out.ok(`✅ 已导出：${args.out}`));
    console.log(out.dim("  · 视图不是事实源：改它无效，改判据走 gd cap req / delta 合入"));
    return 0;
  }
  process.stdout.write(md);
  return 0;
}

/** `cap import <能力id> --file <delta.md> --req <需求id>`（= 走 delta 解析，落到需求目录） */
function capImport(argv, errors) {
  const args = parseArgs(argv);
  const capId = typeof args._[0] === "string" ? args._[0] : "";
  const board = boardOf(argv);
  if (!board) return 1;
  const src = typeof args.file === "string" ? args.file : "";
  const reqId = typeof args.req === "string" ? args.req : "";
  if (errors.length > 0 || !capId || !src || !reqId) {
    console.error(errOut.err("✗ 用法：gd cap import <能力id> --file <delta.md> --req <需求id>"));
    console.error("  · 把外部写的 delta 收进需求目录（reqs/<需求id>/specs/<能力id>.md）并挂点，再 gd cap merge 合入");
    return 1;
  }
  if (!existsSync(src)) {
    console.error(errOut.err(`✗ 文件不存在：${src}`));
    return 1;
  }
  const text = readFileSync(src, "utf8");
  const parsed = parseDelta(text);
  if (!parsed.ok) {
    console.error(errOut.err(`✗ delta 解析失败：${parsed.error}`));
    return 1;
  }
  const rel = deltaPathOf(reqId, capId);
  const abs = join(board.root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text, "utf8");
  const idx = readCapIndex(board.root);
  if (!findCapEntry(idx.capabilities, capId)) {
    console.error(errOut.err(`✗ 能力 ${capId} 不在目录里 —— delta 已落 ${rel}，但挂点不成立`));
    return 1;
  }
  const existing = readReqBindings(board.root, reqId);
  const merged = [...existing];
  const at = merged.findIndex((b) => b.id === capId);
  if (at >= 0) merged[at] = { ...merged[at], role: merged[at].role ?? "owner", delta: rel };
  else merged.push({ id: capId, role: "owner", delta: rel });
  writeReqBindings({ projDir: board.root, reqId, bindings: merged, by: board.id });
  console.log(out.ok(`✅ delta 已收进需求目录：${rel}`));
  console.log(`  段：ADDED ${parsed.delta.added.length} · MODIFIED ${parsed.delta.modified.length} · REMOVED ${parsed.delta.removed.length} · 已挂点需求 ${reqId}`);
  console.log(out.dim(`  合入：gd cap merge ${capId} --req ${reqId}`));
  return 0;
}

// ── 能力影响面与草稿（0.69）────────────────────────────────────

/** 命中按能力归拢：capId → 命中的载体路径（保序） */
function groupHitsByCapability(hits) {
  const byCap = new Map();
  for (const h of hits) {
    const paths = byCap.get(h.capId);
    if (paths) paths.push(h.path);
    else byCap.set(h.capId, [h.path]);
  }
  return byCap;
}

/** `cap draft <需求id> [--write]` —— 算「碰了哪些能力」，可选起 delta 草稿（草稿不参与合入） */
function capDraft(argv, errors) {
  const args = parseArgs(argv);
  const reqId = typeof args._[0] === "string" ? args._[0] : "";
  const board = boardOf(argv);
  if (!board) return 1;
  if (errors.length > 0 || !REQ_ID_SHAPE.test(reqId)) {
    console.error(errOut.err(`✗ 用法：gd cap draft <需求id> [--write] · 需求 id 收到 "${reqId ?? ""}"`));
    return 1;
  }
  const impact = capabilityImpactOf({ projDir: board.root, reqId });
  const byCap = groupHitsByCapability(impact.hits);

  if (args.json === true) {
    console.log(JSON.stringify({ ok: true, data: { req: reqId, ...impact, byCapability: [...byCap].map(([capId, paths]) => ({ capId, paths })) } }, null, 2));
    return 0;
  }

  if (byCap.size === 0) {
    console.log(out.dim(`需求 ${reqId}：交付件没命中任何能力的载体（${impact.note}）`));
    return 0;
  }

  console.log(`需求 ${reqId} 碰到的能力（交付件 ${impact.artifactCount} 件 × 载体 ${impact.carrierCount} 条）：`);
  for (const [capId, paths] of byCap) console.log(`  ${capId.padEnd(24)} ${paths.join(" · ")}`);
  console.log(out.dim(`  ${impact.note}`));

  if (args.write !== true) {
    console.log(out.dim(`  起草稿：gd cap draft ${reqId} --write（只写骨架，判据正文由人填；草稿不参与合入）`));
    return 0;
  }

  // --write：每个命中能力一份骨架草稿（.draft 后缀 ⇒ `cap merge` 不会读到它）
  const written = [];
  for (const [capId, paths] of byCap) {
    const rel = `reqs/${reqId}/specs/${capId}.md.draft`;
    const abs = join(board.root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, renderDeltaDraft({ capId, spec: readCapSpec(board.root, capId), reqId, paths }), "utf8");
    written.push(rel);
  }
  console.log(out.ok(`✅ 已起草稿 ${written.length} 份（骨架 · 不参与合入）：`));
  for (const w of written) console.log(`  ${w}`);
  console.log(out.dim("  下一步：填判据 → 另存为去掉 .draft 的文件（或 gd cap import）→ gd cap merge"));
  return 0;
}

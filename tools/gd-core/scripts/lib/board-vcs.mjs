/**
 * 板账版本库（board VCS）—— 让**账本身**可 diff / 可回滚（0.21.8）
 *
 * 现状痛点：板根在 `<git-common-dir>/gdtwork`，**不在任何仓库里** ⇒ 账被并发写坏、被误删、
 *   或被高危动作（reach/reopen/fold）改错时，只能靠人手工备份，无法追溯"是谁在什么时候改的"。
 *
 * 做法：在**板根**里独立开一个小 git 库（`<板根>/.git`），每次落盘后自动提交一版：
 *   · **默认关闭**——只有显式 `gd core snap --init` 才建库；建过之后自动快照生效（`GD_BOARD_SNAPSHOT=0` 可临时关）
 *   · **尽力而为**——快照失败（无 git / 无身份 / 锁冲突）绝不影响账写入，只静默跳过
 *   · **只在锁内**发生——调用点在 `withBoardLock` 成功返回前，天然串行，不会争 git index
 *
 * 0.22.4 增补：**异地备份与还原（手动一键）**。快照只活在本机同一块盘上，盘坏即账灭；
 *   这里给板账仓接一条远端，把「备份 = push 一条 ref」「还原 = fetch 后覆盖」做成两条命令：
 *   · `snap --backup`：板仓推到**交付仓远端**的独立 ref（缺省 `gd-board`）——账实分离，不污染交付仓分支
 *   · `snap --restore-remote`：拉进临时 ref → **账结构对比** → 点名确认 → 留救援点 → 锁内覆盖
 *   · **不做**逐次写账自动 push / 自动合并 / 定序护栏：备份时机与裁决由人负责（用户拍板口径）。
 * 0.29.9 R-gm-105 增补：**里程碑结版 = 一个指定的备份检查点**——`autoBackupBoard` 只在
 *   「里程碑整体验收结版」（CLI 两套面 + 工作站「标记达成」）后触发一次，仍旧只是普通 snapshot + push，
 *   失败只警告不阻断结版（结版是宣告，账已落盘，不因网络故障回退）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGit } from "./gitcore.mjs";
import { out } from "./style.mjs";
import { parseYaml } from "./yaml.mjs";

/** 账库卫生用的忽略清单（锁与临时件是运行时产物，不入账库） */
const GITIGNORE_TEXT = [".gd/", "*.lock", "*.tmp", ""].join("\n");

/** 备份缺省 ref 名（板仓 → 交付仓远端的一条独立分支；永不参与交付仓合并） */
export const DEFAULT_BACKUP_REF = "gd-board";

/** 备份缺省远端名（板账仓自留的 origin；首次 `--remote` 时写入） */
const BOARD_REMOTE_NAME = "origin";

/** 还原的暂存 ref 前缀（fetch 落点，不碰 HEAD） */
const REMOTE_STAGE_PREFIX = "refs/gd-remote/";

/** 覆盖前救援点前缀（`refs/gd-rescue/<时间戳>`，可用 `snap --restore <hash>` 回退） */
const RESCUE_PREFIX = "refs/gd-rescue/";

/**
 * 板根是否已是**账库**：`.git` 存在 **且**是板（有 `board.yaml`）。
 *   为什么两个条件都要：项目库（`projects/<name>`）也是 git 库，但不能被当成账库——
 *   否则项目模式的里程碑写会被误快照（实测过：提交信息被换成 board 快照，还挡掉了自动推送）。
 */
export function isBoardRepo(boardRoot) {
  const root = String(boardRoot);
  return existsSync(join(root, ".git")) && existsSync(join(root, "board.yaml"));
}

/**
 * 账库卫生（幂等）：保证 `.gitignore` 在位，并把「本应忽略却已进索引」的运行时件摘出跟踪。
 *
 * 为什么单列：老账库（或手工 `git init` 出来的）没有 `.gitignore`，会把 `.gd/board.lock` 一路提交——
 *   备份时把它带去远端、还原时又把**别的机器的陈旧锁**带回来（跨机场景下从噪声升级成故障）。
 *   只动索引（`git rm --cached`），不删工作区文件。
 */
function ensureHygiene(boardRoot) {
  const root = String(boardRoot);
  if (!isBoardRepo(root)) return { ok: false, skipped: "板根不是 git 库（先 gd core snap --init）", changed: [] };
  const changed = [];
  const gi = join(root, ".gitignore");
  if (!existsSync(gi)) {
    writeFileSync(gi, GITIGNORE_TEXT, "utf8");
    changed.push(".gitignore（新建）");
  }
  const tracked = runGit(root, ["ls-files", "-ci", "--exclude-standard"]);
  if (tracked.ok) {
    for (const p of tracked.stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
      const r = runGit(root, ["rm", "--cached", "-q", "--", p]);
      if (r.ok) changed.push(`${p}（摘出跟踪）`);
    }
  }
  return { ok: true, changed };
}

/** 建库（幂等）：git init + 兜底一个初始提交，让后续快照有父提交；已是账库则只补卫生 */
export function ensureBoardRepo(boardRoot) {
  const root = String(boardRoot);
  if (isBoardRepo(root)) return { ok: true, created: false, path: root, hygiene: ensureHygiene(root).changed };
  const init = runGit(root, ["init", "-q"]);
  if (!init.ok) return { ok: false, error: `git init 失败：${init.stderr || init.stdout}` };
  // 板是"账"：别把宿主仓库的 ignore/身份规则带进来，这里自给自足
  runGit(root, ["config", "user.name", "gd-board"]);
  runGit(root, ["config", "user.email", "gd-board@localhost"]);
  const hygiene = ensureHygiene(root).changed;
  const first = snapshot(root, "board: 初始化账库");
  return { ok: true, created: true, path: root, first, hygiene };
}

/** 是否启用自动快照（库存在 + 未被环境变量关掉） */
export function snapshotEnabled(boardRoot, env = process.env) {
  if (String(env?.GD_BOARD_SNAPSHOT ?? "") === "0") return false;
  return isBoardRepo(boardRoot);
}

/**
 * 打一版快照（**尽力而为**：任何失败都只返回原因，不抛、不影响写账）。
 * @returns {{ok: boolean, hash?: string|null, nochange?: boolean, skipped?: string}}
 */
export function snapshot(boardRoot, message) {
  const root = String(boardRoot);
  if (!isBoardRepo(root)) return { ok: false, skipped: "板根不是 git 库（先 gd core snap --init）" };
  // 卫生先补（一次 existsSync，快）：老账库缺 .gitignore 时别把锁文件一路提交下去
  if (!existsSync(join(root, ".gitignore"))) ensureHygiene(root);
  const add = runGit(root, ["add", "-A"]);
  if (!add.ok) return { ok: false, skipped: `git add 失败：${add.stderr || add.stdout}` };
  const dirty = runGit(root, ["status", "--porcelain"]);
  if (dirty.ok && dirty.stdout.trim() === "") return { ok: true, nochange: true, hash: null };
  const commit = runGit(root, ["commit", "-q", "-m", String(message ?? "board: 快照")]);
  if (!commit.ok) return { ok: false, skipped: `git commit 失败：${commit.stderr || commit.stdout}` };
  const hash = runGit(root, ["rev-parse", "--short", "HEAD"]).stdout.trim();
  return { ok: true, hash };
}

/** 最近的账快照（人读 / `--json`） */
export function log(boardRoot, limit = 10) {
  const root = String(boardRoot);
  if (!isBoardRepo(root)) return { ok: false, skipped: "板根不是 git 库（先 gd core snap --init）", entries: [] };
  const r = runGit(root, ["log", `-${Number(limit) || 10}`, "--pretty=format:%h|%ad|%s", "--date=short"]);
  if (!r.ok) return { ok: false, skipped: r.stderr || r.stdout, entries: [] };
  const entries = r.stdout.split("\n").filter(Boolean).map((l) => {
    const [hash, at, ...rest] = l.split("|");
    return { hash, at, subject: rest.join("|") };
  });
  return { ok: true, entries };
}

/** 回滚到某个快照（供人工救援：`gd core snap --restore <hash>`；调用方负责持锁） */
export function restore(boardRoot, hash) {
  const root = String(boardRoot);
  const target = String(hash ?? "").trim();
  if (!target) return { ok: false, error: "缺目标快照（git hash）" };
  if (!isBoardRepo(root)) return { ok: false, error: "板根不是 git 库（先 gd core snap --init）" };
  const r = runGit(root, ["reset", "--hard", target]);
  if (!r.ok) return { ok: false, error: `reset 失败：${r.stderr || r.stdout}` };
  return { ok: true, hash: runGit(root, ["rev-parse", "--short", "HEAD"]).stdout.trim() };
}

// ──────────────────────────────────────────────────────────────
// 0.22.4 · 异地备份与还原（手动一键）—— backup / restore-remote
// ──────────────────────────────────────────────────────────────

/** 某个 git 仓的 origin 地址；未配置 ⇒ null */
function originUrl(dir) {
  const r = runGit(String(dir), ["remote", "get-url", BOARD_REMOTE_NAME]);
  const url = r.ok ? r.stdout.trim() : "";
  return url || null;
}

/** 板账仓已配置的远端（`origin`）；未配置 ⇒ null */
export function boardOrigin(boardRoot) {
  return originUrl(boardRoot);
}

/** 写板账仓 origin（幂等：已有则 set-url）——只在 `--remote` 显式给出时调用，不悄悄改配置 */
export function setBoardOrigin(boardRoot, url) {
  const root = String(boardRoot);
  const has = runGit(root, ["remote", "get-url", BOARD_REMOTE_NAME]).ok;
  const r = runGit(root, has
    ? ["remote", "set-url", BOARD_REMOTE_NAME, String(url)]
    : ["remote", "add", BOARD_REMOTE_NAME, String(url)]);
  return r.ok ? { ok: true, url: String(url) } : { ok: false, error: r.stderr || r.stdout };
}

/** 交付仓的 origin（备份缺省落点）——板实分离：账推交付仓远端，占一条独立 ref，不污染交付分支 */
export function deliveryOrigin(repoDir) {
  const repo = String(repoDir ?? "").trim();
  return repo && existsSync(repo) ? originUrl(repo) : null;
}

/**
 * 备份远端落点解析（`--remote` 显式 > 板账仓 origin > 交付仓 origin）。
 *   `snap --backup` 与结版自动备份**同一套判据**——两条路不该推出不同的地方。
 * @returns {{url: string|null, ref: string, source: string, explicit: boolean}}
 */
export function resolveBackupTarget(board, { remote, ref } = {}) {
  const flag = typeof remote === "string" && remote.trim() ? remote.trim() : null;
  const refName = typeof ref === "string" && ref.trim() ? ref.trim() : DEFAULT_BACKUP_REF;
  if (flag) return { url: flag, ref: refName, source: "--remote", explicit: true };
  const own = boardOrigin(board?.root);
  if (own) return { url: own, ref: refName, source: "板账仓 origin", explicit: false };
  const repo = deliveryOrigin(board?.repo);
  if (repo) return { url: repo, ref: refName, source: `交付仓 origin（${board?.repo || "board.yaml 未记 repo"}）`, explicit: false };
  return { url: null, ref: refName, source: "无", explicit: false };
}

/**
 * 结版后的**自动异地备份**（0.29.9 R-gm-105）：前置快照 → push 一条 ref → 留痕。
 *   尽力而为：无远端 / 非账库 / git 报错都只回 status，**不抛、不影响已经落盘的账**——
 *   调用方按 `status` 决定文案（failed 只是警告，不是结版失败）。
 * @param {{root: string, repo?: string}} board
 * @returns {{ok: boolean, status: "pushed"|"up-to-date"|"skipped"|"failed", ref: string, url?: string|null, hash?: string, source?: string, reason?: string}}
 */
export function autoBackupBoard(board, { message } = {}) {
  const root = String(board?.root ?? "");
  const ref = DEFAULT_BACKUP_REF;
  const skip = (reason) => ({ ok: false, status: "skipped", ref, reason });
  if (!root) return skip("无板根（项目账结版不动板账）");
  if (!isBoardRepo(root)) return skip("板根不是账库（先 gd core snap --init）");
  const target = resolveBackupTarget(board, {});
  if (!target.url) return skip("无可用远端（给交付仓配 origin，或 gd core snap --backup --remote <url>）");
  // 前置快照（幂等）：保证「最后一次写账」也被带走；快照失败不挡 push（账已落盘，HEAD 里就有）
  snapshot(root, String(message ?? `board: 结版备份快照 ${new Date().toISOString()}`));
  const r = push(root, { url: target.url, ref });
  if (!r.ok) {
    return { ok: false, status: "failed", ref, url: target.url, source: target.source, hash: r.hash ?? headOf(root), reason: r.error };
  }
  recordBackup(root, { url: target.url, ref, hash: r.hash });
  return { ok: true, status: r.upToDate ? "up-to-date" : "pushed", ref, url: target.url, source: target.source, hash: r.hash };
}

/**
 * `autoBackupBoard` 的结果 → 人读几行（CLI 两套面共用一张 message 表；两处只差补推命令的族名）。
 *   失败只是**警告**：结版是宣告、账已落盘，网络故障不该把已完成的宣告退回去。
 * @param {object} r `autoBackupBoard` 的返回
 * @param {"gd"|"gd-core"} cmd 该面的命令名（只用于补推提示）
 * @returns {string[]}
 */
export function backupOutcomeLines(r, cmd = "gd") {
  const where = r.url ? `（${r.source}）` : "";
  switch (r.status) {
    case "pushed":
      return [out.ok(`✅ 结版已异地备份 → ${r.ref} @ ${r.hash}${where}`), out.dim(`  · 远端：${r.url}`)];
    case "up-to-date":
      return [out.dim(`  · 异地备份已是最新（${r.ref} @ ${r.hash}）`)];
    case "failed":
      return [out.warn(`⚠ 结版异地备份失败：${r.reason}`), out.dim(`  · 账已落盘，不影响结版——补推：${cmd} core snap --backup`)];
    default:
      return [out.dim(`  · 跳过结版异地备份：${r.reason}`)];
  }
}

/** 当前 HEAD（短 hash） */
export function headOf(boardRoot) {
  return runGit(String(boardRoot), ["rev-parse", "--short", "HEAD"]).stdout.trim();
}

/**
 * 备份：把板账 HEAD 推到远端一条 ref。
 *   远端**非快进时由 git 直接拒**（不会静默覆盖对方）——出路：先 `--restore-remote` 对比并还原。
 *   @returns {{ok:boolean, hash?:string, upToDate?:boolean, nonFastForward?:boolean, error?:string}}
 */
export function push(boardRoot, { url, ref = DEFAULT_BACKUP_REF } = {}) {
  const root = String(boardRoot);
  if (!isBoardRepo(root)) return { ok: false, error: "板根不是 git 库（先 gd core snap --init）" };
  if (!String(url ?? "").trim()) return { ok: false, error: "缺远端地址（--remote <url>，或给交付仓配 origin 后即可零参数）" };
  const hash = headOf(root);
  const r = runGit(root, ["push", String(url), `HEAD:refs/heads/${ref}`], { timeoutMs: 180000 });
  const text = `${r.stdout}\n${r.stderr}`;
  if (!r.ok) {
    const nonFF = /non-fast-forward|fetch first|\[rejected\]/i.test(text);
    return {
      ok: false,
      hash,
      nonFastForward: nonFF,
      error: nonFF
        ? `远端比你新（非快进，git 已拒绝）——先对比并还原：gd core snap --restore-remote`
        : (r.stderr || r.stdout || "push 失败").trim(),
    };
  }
  return { ok: true, hash, url: String(url), ref, upToDate: /up-to-date/i.test(text) };
}

/**
 * 拉远端到**暂存 ref**（`refs/gd-remote/<ref>`），**不碰 HEAD 也不碰工作区**。
 *   还原是两步走：先 fetch 对比，确认后才覆盖。
 */
export function fetchRemote(boardRoot, { url, ref = DEFAULT_BACKUP_REF } = {}) {
  const root = String(boardRoot);
  if (!isBoardRepo(root)) return { ok: false, error: "板根不是 git 库（先 gd core snap --init）" };
  if (!String(url ?? "").trim()) return { ok: false, error: "缺远端地址（--remote <url>，或给交付仓配 origin 后即可零参数）" };
  const stage = `${REMOTE_STAGE_PREFIX}${ref}`;
  const r = runGit(root, ["fetch", "--force", String(url), `+refs/heads/${ref}:${stage}`], { timeoutMs: 180000 });
  if (!r.ok) {
    const txt = (r.stderr || r.stdout || "").trim();
    return { ok: false, error: /couldn't find remote ref|could not find remote ref/i.test(txt)
      ? `远端没有 ref ${ref}（先在本机跑 gd core snap --backup 备份一次）`
      : (txt || "fetch 失败") };
  }
  const full = runGit(root, ["rev-parse", stage]);
  if (!full.ok) return { ok: false, error: `暂存 ref 解析失败：${full.stderr || full.stdout}` };
  const hash = full.stdout.trim();
  return { ok: true, stage, ref: String(ref), hash, short: hash.slice(0, 7) };
}

/** 两个 ref 之间某方向的提交（人读用：`<from>..<to>`） */
export function commitsBetween(boardRoot, fromRef, toRef, limit = 20) {
  const r = runGit(String(boardRoot), ["log", `-n`, String(limit), "--pretty=format:%h\t%ad\t%s", "--date=short", `${fromRef}..${toRef}`]);
  if (!r.ok) return [];
  return r.stdout.split("\n").filter(Boolean).map((l) => {
    const [hash, at, ...rest] = l.split("\t");
    return { hash, at, subject: rest.join("\t") };
  });
}

/** 本地相对某个 ref 的领先 / 落后版数 */
export function aheadBehind(boardRoot, ref) {
  const root = String(boardRoot);
  const cnt = (range) => {
    const r = runGit(root, ["rev-list", "--count", range]);
    return r.ok ? Number(String(r.stdout).trim()) || 0 : 0;
  };
  return { ahead: cnt(`${ref}..HEAD`), behind: cnt(`HEAD..${ref}`) };
}

/** 账结构对比要读的四份板级账文件（子目录里的 task-list 不下沉逐条 diff） */
const ACCOUNT_FILES = ["reqs/index.yaml", "subvers.yaml", "milestones.yaml", "lanes.yaml"];

/** 从某个 ref 读板根内某个文件；不存在 ⇒ null */
function fileAt(boardRoot, ref, relPath) {
  const r = runGit(String(boardRoot), ["show", `${ref}:${relPath}`]);
  return r.ok ? r.stdout : null;
}

/** 把某版账归一成可比的账结构（读不到的账文件记进 `missing`，不抛） */
function accountAt(boardRoot, ref) {
  const acc = { reqs: [], tasks: { count: 0, done: 0 }, subvers: [], lanes: [], milestones: [], missing: [] };
  for (const f of ACCOUNT_FILES) {
    const txt = fileAt(boardRoot, ref, f);
    if (txt === null) { acc.missing.push(f); continue; }
    let doc;
    try { doc = parseYaml(txt) || {}; } catch { acc.missing.push(`${f}（解析失败）`); continue; }
    if (f === "reqs/index.yaml") {
      acc.reqs = (Array.isArray(doc.requirements) ? doc.requirements : []).map((r) => ({
        id: String(r?.id ?? ""),
        title: String(r?.title ?? ""),
        status: String(r?.status ?? ""),
        subver: r?.subver ? String(r.subver) : "",
        task_count: Number(r?.task_count ?? 0) || 0,
        task_done: Number(r?.task_done ?? 0) || 0,
      }));
      acc.tasks = {
        count: acc.reqs.reduce((a, r) => a + r.task_count, 0),
        done: acc.reqs.reduce((a, r) => a + r.task_done, 0),
      };
    } else if (f === "subvers.yaml") {
      acc.subvers = (Array.isArray(doc.subvers) ? doc.subvers : []).map((s) => String(s?.alias ?? "")).filter(Boolean);
    } else if (f === "lanes.yaml") {
      acc.lanes = (Array.isArray(doc.lanes) ? doc.lanes : []).map((l) => `${l?.version}=${l?.owner ?? ""}`);
    } else {
      acc.milestones = (Array.isArray(doc.milestones) ? doc.milestones : []).map((m) => `${m?.id}:${m?.status ?? ""}`);
    }
  }
  return acc;
}

/** 账结构对比（本地 HEAD vs 远端 ref）——还原前给人读的"差在哪" */
export function compareAccounts(boardRoot, ref) {
  const local = accountAt(boardRoot, "HEAD");
  const remote = accountAt(boardRoot, ref);
  const localIds = new Set(local.reqs.map((r) => r.id));
  const remoteIds = new Set(remote.reqs.map((r) => r.id));
  return {
    local,
    remote,
    reqsAdded: remote.reqs.filter((r) => !localIds.has(r.id)),
    reqsRemoved: local.reqs.filter((r) => !remoteIds.has(r.id)),
    // 同 id 但内容不同：既抓「状态漂移」，也把**跨机撞号**（两台机各自从同一个 next_req_no 数起，
    //   同一个 R-id 指两个不同需求）暴露出来——只看增/删会把这种情况看成「无变化」，那是最危险的静默。
    reqsChanged: remote.reqs
      .map((r) => ({ remote: r, local: local.reqs.find((x) => x.id === r.id) }))
      .filter(({ remote: r, local: l }) => l && (l.title !== r.title || l.status !== r.status || l.subver !== r.subver || l.task_count !== r.task_count || l.task_done !== r.task_done)),
    taskDelta: { count: remote.tasks.count - local.tasks.count, done: remote.tasks.done - local.tasks.done },
    subversAdded: remote.subvers.filter((s) => !local.subvers.includes(s)),
    lanesChanged: remote.lanes.filter((l) => !local.lanes.includes(l)),
    milestones: {
      added: remote.milestones.filter((m) => !local.milestones.includes(m)),
      dropped: local.milestones.filter((m) => !remote.milestones.includes(m)),
    },
  };
}

/**
 * 覆盖前救援点：把当前 HEAD 记进 `refs/gd-rescue/<时间戳>`（不切分支、不动工作区）。
 *   覆盖后想反悔：`gd core snap --restore <hash> --confirm <hash>`。
 */
export function rescuePoint(boardRoot, at = new Date()) {
  const root = String(boardRoot);
  if (!isBoardRepo(root)) return { ok: false, error: "板根不是 git 库（先 gd core snap --init）" };
  const tag = at.toISOString().replace(/\.\d+Z$/, "").replace(/[:]/g, "");
  const name = `${RESCUE_PREFIX}${tag}`;
  const short = headOf(root);
  const r = runGit(root, ["update-ref", name, "HEAD"]);
  return r.ok ? { ok: true, ref: name, hash: short } : { ok: false, error: r.stderr || r.stdout };
}

/**
 * 本机备份留痕（`.gd/` 已被忽略 ⇒ 只记本机事实，不随账走）。
 *   为什么留痕：“有没有过异地副本”在账里看不出来（远端配置也不一定在）——体检得有个凭据。
 */
export function recordBackup(boardRoot, { url, ref, hash } = {}) {
  try {
    // 新板在写第一条需求前没有 `.gd/`（那是锁目录）⇒ 自建：否则首次备份留不下痕，体检会永远说「从未备份过」
    const dir = join(String(boardRoot), ".gd");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "backup.json"), `${JSON.stringify({ at: new Date().toISOString(), url: String(url ?? ""), ref: String(ref ?? ""), hash: String(hash ?? "") }, null, 2)}\n`, "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, skipped: e.message };
  }
}

/** 读备份留痕；从未备份过 ⇒ null（尽力而为，坏文件当没有） */
export function readBackupMark(boardRoot) {
  const p = join(String(boardRoot), ".gd", "backup.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

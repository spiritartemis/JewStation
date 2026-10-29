/**
 * 认领（claim）—— **单一实现**：会话对任务的「占用」语义（core 层 · 0.19.0 C3）
 *
 * 设计权威源：`docs/gd-core-session-workflow-design.md` §4。
 *
 * 两个概念必须分开（这是 core 最容易设计错的地方）：
 *   · **负责人 `executor`** —— 稳定的执行体名（来自板内名册），长命、进账进 git；
 *   · **占用 `claim{}`** —— 谁此刻真在干（session / pid / host / since / heartbeat），短命、租约到期自动可抢。
 * 为什么不把 session id 当负责人：会话重启「谁负责」就丢了、人看不懂、一个会话可能同时干几个任务。
 *
 * 租约口径（已拍决议）：**默认 15 分钟**；每次 `gd work` 动账自动续期（写 heartbeat）；
 *   超时即视为可抢（不设专人心跳进程——进程被 kill 也不会把任务永久锁死）。
 *
 * 依赖方向：本模块属 **core**（只依赖 node 内置）。**不得** import 席位 / 工作站 / 注册表等 app 层件。
 */
import { hostname } from "node:os";
import { ledgerBlock } from "./board.mjs"; // 账内内联 JSON 块的统一解析口径

/** 默认租约（分钟）——已拍决议 15 */
export const DEFAULT_LEASE_MINUTES = 15;

/** 认领时从环境取的会话标识（pi 会话 id；无则退化为 pid+host，仍可追踪） */
export function sessionIdFromEnv(env = process.env) {
  // 取**第一个非空**的那个（B-gm-000061）：用 `??` 链会被空串短路——包装脚本把 PI_SESSION_ID 设成 "" 时，
  //   GD_SESSION 就永远读不到，人明明 export 了却还是退化成 pid-<pid>，症状和「忘了 export」一模一样。
  const raw = [env.PI_SESSION_ID, env.PI_INTERCOM_SESSION_ID, env.GD_SESSION]
    .map((v) => String(v ?? "").trim())
    .find((v) => v) ?? "";
  if (!raw) return `pid-${process.pid}`;
  return raw.replace(/-/g, "").slice(0, 8); // 短号：人读够用、账里不占宽
}

/**
 * 会话号是不是「裸进程」退化的（没 export `GD_SESSION` / `PI_SESSION_ID` ⇒ 每条 gd 命令一个新 pid）。
 *
 * 为什么值得单独判（B-gm-000061）：退化会话**永远不会续期**——续期靠「同一会话再动账」，
 * 而下一个进程的 pid 必然不同。于是它有两件后果，缺一条人都只会去干等：
 *   ① 挡自己：上一条命令留下的占用，下一条命令眼里就是「他人持有」（E_CLAIMED）；
 *   ② 保不住活：没有任何后续命令能续期，15 分钟后必然可被抢（长活干到一半被人接走）。
 */
export function isPidSession(session) {
  return /^pid-\d+$/.test(String(session ?? "").trim());
}

/**
 * 占用拒单的出路 —— `claim` / `handoff` / `release` 共用一份措辞（B-gm-000061）。
 *
 * 判据：**双方都是 pid 会话** ⇒ 几乎一定是同一个人连跑两条命令
 *   （同机真有两个裸进程抢同一任务，概率远低于「忘了 export」）。
 *   这时先教固定会话号，再给「立刻能走」的那一步——只给「等 15 分钟」等于让人干等。
 *
 * @returns {string[]} 裸行（不带缩进前缀，由调用方决定怎么排）
 */
export function claimBlockHints({ taskId, holder, session, ttl = DEFAULT_LEASE_MINUTES }) {
  const h = String(holder ?? "").trim();
  if (isPidSession(h) && isPidSession(session)) {
    return [
      `你这台 shell 没设会话号：每条 gd 命令都是新进程 ⇒ 会话退化成 ${h}，自己撞自己`,
      `正解：export GD_SESSION=<固定短名>（≤8 字符，整轮别改）——之后认领 / 交件 / 交还都认得出是你`,
      `现在就要接过来：gd work release ${taskId} --force（裸进程会话不会续期，也可以等 ${ttl} 分钟自动过期）`,
    ];
  }
  if (isPidSession(h)) {
    return [
      `持有者 ${h} 是裸进程会话（没设 GD_SESSION）——它不会续期，${ttl} 分钟后自动可抢`,
      `确认那是你自己上一条命令：gd work release ${taskId} --force`,
    ];
  }
  return [`等租约过期（${ttl} 分钟无心跳即自动可抢），或让持有者 gd work release ${taskId}`];
}

/** 宿主名（审计用；认领只在同机有意义，跨机协作走 app 层） */
export function hostOf() {
  try {
    return hostname();
  } catch {
    return "unknown";
  }
}

/** 任务上的占用（缺省 = 无） */
export function claimOf(task) {
  const c = ledgerBlock(task?.claim);
  if (!c) return null;
  const session = String(c.session ?? "").trim();
  if (!session) return null;
  const hb = String(c.heartbeat ?? c.since ?? "").trim();
  const at = hb ? Date.parse(hb) : NaN;
  return {
    session,
    pid: c.pid ?? null,
    host: String(c.host ?? "").trim() || null,
    since: c.since ? String(c.since) : null,
    heartbeat: hb || null,
    at: Number.isFinite(at) ? at : null,
  };
}

/** 租约是否过期（无 claim 视为不算「持有」；heartbeat 缺失或坏格式视为已过期，宁松不锁死） */
export function isClaimExpired(claim, { minutes = DEFAULT_LEASE_MINUTES, now = Date.now() } = {}) {
  if (!claim) return true;
  if (!claim.at) return true;
  return now - claim.at > minutes * 60_000;
}

/** 人读描述（报错 / 列表共用一份措辞） */
export function describeClaim(claim, { minutes = DEFAULT_LEASE_MINUTES, now = Date.now() } = {}) {
  if (!claim) return "未认领";
  const left = Math.round((minutes * 60_000 - (now - (claim.at ?? now))) / 60_000);
  return `${claim.session}${claim.host ? `@${claim.host}` : ""}${left > 0 ? `（租约剩 ${left} 分钟）` : "（租约已过期，可直接认领）"}`;
}

/** 生成/刷新一次占用（自动续期 = 保留 since，刷新 heartbeat） */
export function makeClaim({ existing = null, session, now = new Date(), ttlMinutes = DEFAULT_LEASE_MINUTES }) {
  const iso = now.toISOString();
  const keepSince = existing?.since && !isClaimExpired(claimOf({ claim: existing }), { minutes: ttlMinutes, now: now.getTime() }) ? existing.since : iso;
  return { session, pid: process.pid, host: hostOf(), since: keepSince, heartbeat: iso };
}

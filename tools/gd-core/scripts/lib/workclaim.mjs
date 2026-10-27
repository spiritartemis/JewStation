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
  const raw = String(env.PI_SESSION_ID ?? env.PI_INTERCOM_SESSION_ID ?? env.GD_SESSION ?? "").trim();
  if (!raw) return `pid-${process.pid}`;
  return raw.replace(/-/g, "").slice(0, 8); // 短号：人读够用、账里不占宽
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

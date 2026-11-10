import { cloudConfigured } from "@/lib/cloud";
import { cloudRpc } from "@/lib/store/postgres";
import { POLICY_VERSION, RETENTION_DAYS, isVisitorId, type ConsentScope } from "./privacy";

/**
 * 隐私数据的**服务端**读写（0.5.0）
 *
 * 只在 route handler 里用，别让客户端组件 import 到它——它会把云 SDK 拉进浏览器包。
 *
 * 全链路的第一原则是「降级不报错」（B-4.5 明确要求）：
 * 持久化失败时页面照常浏览，顶多个性化不生效。所以这里的每个函数都把异常吞掉、
 * 返回一个安全的空结果，而不是让一次网络抖动把商品页打成 500。
 * 但**不能**把失败当成功：写入类函数的返回值里带 ok，调用方可据此决定是否 Set-Cookie。
 */

export type ConsentAction = "grant" | "update" | "revoke";

export type RecordResult = { ok: true; deletedViews?: number } | { ok: false; reason: string };

/** 云端未配置（本地开发 / 演示模式）时，一切隐私写入都视为「暂不支持」，不假装成功 */
function ready(): boolean {
  return cloudConfigured();
}

/**
 * 建或续期访客。只有用户明确接受个性化时才会走到这里。
 * 返回 false 表示没建成（云端不可用 / 参数不合法），调用方**不应**下发访客 cookie。
 */
export async function ensureVisitor(id: string): Promise<boolean> {
  if (!ready() || !isVisitorId(id)) return false;
  try {
    const res = await cloudRpc<{ ok?: boolean }>("jew_ensure_visitor", {
      p_id: id,
      p_ttl_days: RETENTION_DAYS,
    });
    return res?.ok === true;
  } catch {
    return false;
  }
}

/**
 * 记一次同意。撤回时数据库会在同一事务里删掉该访客的浏览记录。
 * `deletedViews` 只用于验收取证与日志，不给前端展示具体数字（那反而是信息泄露）。
 */
export async function logConsent(
  id: string,
  scope: ConsentScope,
  action: ConsentAction,
  policyVer: string = POLICY_VERSION,
): Promise<RecordResult> {
  if (!ready() || !isVisitorId(id)) return { ok: false, reason: "not_ready" };
  try {
    const res = await cloudRpc<{ ok?: boolean; reason?: string; deletedViews?: number }>(
      "jew_log_consent",
      {
        p_id: id,
        // 只传两个布尔值，不传时间戳、UA、referrer 之类多余信息
        p_scope: { necessary: true, personalisation: scope.personalisation === true },
        p_policy_ver: policyVer,
        p_action: action,
      },
    );
    if (res?.ok === true) return { ok: true, deletedViews: res.deletedViews ?? 0 };
    return { ok: false, reason: res?.reason ?? "unknown" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * 记一次商品浏览。没有任何同意就直接返回 no_consent——数据库函数会再校验一遍，
 * 这里先挡一次是为了省掉一趟无谓的请求。
 */
export async function recordView(
  id: string,
  slug: string,
  tags: string[],
): Promise<RecordResult> {
  if (!ready() || !isVisitorId(id)) return { ok: false, reason: "not_ready" };
  try {
    const res = await cloudRpc<{ ok?: boolean; reason?: string }>("jew_record_view", {
      p_id: id,
      p_slug: slug,
      // 标签快照最多 20 个、每个 40 字，防止脏数据撑爆行
      p_tags: tags
        .filter((t) => typeof t === "string" && t.length > 0)
        .slice(0, 20)
        .map((t) => t.slice(0, 40)),
    });
    if (res?.ok === true) return { ok: true };
    return { ok: false, reason: res?.reason ?? "unknown" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * 取最近浏览。0.5.0 只在验收脚本里用，0.6.0 的标签推荐会直接吃它。
 * 撤回后数据库侧就查不到东西了，这里再兜一层空数组。
 */
export async function recentViews(
  id: string,
  limit = 20,
): Promise<{ slug: string; tags: string[]; viewedAt: string }[]> {
  if (!ready() || !isVisitorId(id)) return [];
  try {
    const res = await cloudRpc<unknown>("jew_recent_views", { p_id: id, p_limit: limit });
    if (!Array.isArray(res)) return [];
    return res
      .map((row) => row as { slug?: unknown; tags?: unknown; viewedAt?: unknown })
      .filter((row) => typeof row.slug === "string")
      .map((row) => ({
        slug: row.slug as string,
        tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
        viewedAt: typeof row.viewedAt === "string" ? row.viewedAt : "",
      }));
  } catch {
    return [];
  }
}

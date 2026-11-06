/**
 * 「我的订单」的本机凭据（0.4.2）
 *
 * 目前没有账号体系（账户与订阅在 m-1d/1e），服务端也不允许按邮箱列举订单——
 * 那样任何人填一个邮箱就能看到别人买过什么。所以清单只存在**这台浏览器**里：
 * 下单成功、或者用带口令的订单链接打开确认页/支付页时，把「订单号 + accessToken」
 * 记下来；列表页拿这些凭据逐个去服务端换最新状态。
 *
 * 安全边界：
 * - localStorage 是用户可编辑的，读出来一律过 `sanitizeOrderHistory()`；
 * - 凭据只是「钥匙」，真正的可见性由服务端 `getOrder(id, token)` 判定，
 *   伪造 / 过期的条目查不到就自动不显示，不会泄露任何订单内容；
 * - 不存收货地址、邮箱、金额等订单内容，只存能查到它的两个字符串。
 */

export const ORDER_HISTORY_KEY = "mm.orders.v1";
/** 只留最近 50 单：一个人不会在一台设备上翻几百单，也避免一次请求打爆服务端 */
export const MAX_ORDER_HISTORY = 50;

export type OrderCredential = {
  id: string;
  token: string;
  /** 本机登记时间，仅用于排序；真实下单时间以服务端 createdAt 为准 */
  addedAt: string;
};

const ID_RE = /^[A-Za-z0-9_-]{3,40}$/;
const TOKEN_RE = /^[A-Za-z0-9._~-]{16,200}$/;

function valid(item: unknown): item is OrderCredential {
  if (!item || typeof item !== "object") return false;
  const o = item as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    ID_RE.test(o.id) &&
    typeof o.token === "string" &&
    TOKEN_RE.test(o.token) &&
    typeof o.addedAt === "string"
  );
}

/** 反序列化防线：脏数据整条丢弃，同一订单号去重，超过上限截断 */
export function sanitizeOrderHistory(raw: unknown): OrderCredential[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: OrderCredential[] = [];
  for (const item of raw) {
    if (!valid(item)) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= MAX_ORDER_HISTORY) break;
  }
  return out;
}

/** 只在客户端调用；服务端渲染时返回空数组，不碰 window */
export function readOrderHistory(): OrderCredential[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ORDER_HISTORY_KEY);
    return raw ? sanitizeOrderHistory(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/** 登记一笔订单；已存在时把口令更新为最新值并挪到最前 */
export function recordOrder(id: string, token: string): void {
  if (typeof window === "undefined") return;
  if (!ID_RE.test(id) || !TOKEN_RE.test(token)) return;
  try {
    const prev = readOrderHistory().filter((o) => o.id !== id);
    const next: OrderCredential[] = [
      { id, token, addedAt: new Date().toISOString() },
      ...prev,
    ].slice(0, MAX_ORDER_HISTORY);
    window.localStorage.setItem(ORDER_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式 / 配额满：清单不可用，但订单链接本身仍然有效，不因此打断下单
  }
}

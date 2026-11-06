import { createWorkBuddyCloud } from "@tencent-ai/workbuddy-cloud-sdk";
import { getProductBySlug } from "@/lib/products";
import { CLOUD } from "@/lib/cloud";
import type {
  Order,
  OrderStatus,
  ReserveItem,
  ReserveResult,
  StockSnapshot,
  Store,
} from "./types";

/**
 * WorkBuddy 云数据库实现（m-1c / 1c-2）
 *
 * 为什么用「数据库函数」而不是直接在表上增删改：
 * 1. **扣库存必须原子**。两单同时抢最后一件孤品，只能成功一个。
 *    `jew_reserve_stock` 在一个事务里先 `SELECT ... FOR UPDATE` 锁行、全量校验、
 *    再全量扣减；任何一件不足就一件都不动。前端拿到的是 ok/reason，不是半截数据。
 * 2. **订单表不该对匿名可读**。四张表全部开启 RLS 且不给 anon 任何策略，
 *    唯一入口是带口令校验的 `SECURITY DEFINER` 函数。
 *    所以即使 publishableKey 是公开的，别人也读不到别人的订单、改不动库存。
 *
 * 这里写的所有 SQL 名字（jew_*）都在数据库侧建好了；改结构请连同函数一起改。
 */

let client: ReturnType<typeof createWorkBuddyCloud> | null = null;

function database() {
  if (!client) {
    client = createWorkBuddyCloud({
      endpoint: CLOUD.endpoint,
      publishableKey: CLOUD.publishableKey,
    });
  }
  return client.database;
}

/**
 * 调数据库函数。SDK 用 `{ data, error }` 信封返回，**不会抛异常**，
 * 所以这里必须主动把 error 抛出来——否则写失败会被当成成功，静默丢单。
 *
 * 类型断言的原因：SDK 的 rpc 是 supabase 那套按 schema 泛型推断的签名，
 * 我们没生成 Database 类型，参数位会被推成 undefined。运行时行为与 supabase-js 一致。
 */
type RpcCall = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (database().rpc as unknown as RpcCall)(fn, args);
  if (error) {
    const msg = (error as { message?: string }).message ?? "unknown error";
    throw new Error(`cloud database ${fn}: ${msg}`);
  }
  return data as T;
}

type ReserveRpc = { ok: boolean; slug?: string; reason?: string };

export const cloudStore: Store = {
  async reserveStock(items: ReserveItem[]): Promise<ReserveResult> {
    for (const item of items) {
      if (!getProductBySlug(item.slug)) {
        return { ok: false, slug: item.slug, reason: "unknown_product" };
      }
    }

    // seed 只在「该商品第一次出现在库存表里」时生效（ON CONFLICT DO NOTHING），
    // 之后一律以表里的数为准，不会被商品 JSON 里的初始值重置回去
    const payload = items.map((item) => ({
      slug: item.slug,
      qty: item.qty,
      seed: Math.max(0, getProductBySlug(item.slug)?.stock ?? 0),
    }));

    const res = await rpc<ReserveRpc>("jew_reserve_stock", { p_items: payload });
    if (res?.ok) return { ok: true };

    return {
      ok: false,
      slug: res?.slug || items[0]?.slug || "",
      reason: res?.reason === "unknown_product" ? "unknown_product" : "out_of_stock",
    };
  },

  async releaseStock(items: ReserveItem[]): Promise<void> {
    if (!items.length) return;
    await rpc<null>("jew_release_stock", {
      p_items: items.map((item) => ({ slug: item.slug, qty: item.qty })),
    });
  },

  async readStock(slugs: string[]): Promise<StockSnapshot> {
    if (!slugs.length) return {};
    const stored = await rpc<Record<string, number> | null>("jew_read_stock", { p_slugs: slugs });
    // 表里还没有这个商品时，用商品数据里的 stock 兜底，避免后台看到一片 0
    return Object.fromEntries(
      slugs.map((slug) => [
        slug,
        typeof stored?.[slug] === "number"
          ? stored[slug]
          : Math.max(0, getProductBySlug(slug)?.stock ?? 0),
      ]),
    );
  },

  async putOrder(order: Order): Promise<void> {
    await rpc<{ ok: boolean }>("jew_put_order", { p_order: order });
  },

  async getOrder(id: string, token: string): Promise<Order | null> {
    if (!id || !token) return null;
    const found = await rpc<Order | null>("jew_get_order", { p_id: id, p_token: token });
    return found ?? null;
  },

  async updateOrderStatus(id: string, status: OrderStatus, token: string): Promise<Order | null> {
    if (!id || !token) return null;
    const next = await rpc<Order | null>("jew_set_order_status", {
      p_id: id,
      p_token: token,
      p_status: status,
    });
    return next ?? null;
  },

  async claimPaymentKey(key: string): Promise<boolean> {
    // 主键冲突就是「已经处理过」：一条 INSERT 完成判定，不先查再写
    const first = await rpc<boolean>("jew_claim_payment_key", { p_key: key });
    return first === true;
  },

  async appendOutbox(entry): Promise<void> {
    await rpc<null>("jew_append_outbox", { p_entry: entry });
    // 日志只打类型与主题，不打收件邮箱——订单页可能被截图外传
    console.info(`[mail:outbox] ${entry.kind} · ${entry.subject}`);
  },
};

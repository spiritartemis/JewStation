import { getProductBySlug } from "@/lib/products";
import type {
  Order,
  OrderStatus,
  ReserveItem,
  ReserveResult,
  StockSnapshot,
  Store,
} from "./types";

/**
 * Upstash Redis 实现（m-1c / 1c-2）
 *
 * 走 REST 接口而不是装 `@upstash/redis`：只有几个命令，一条 fetch 就够，
 * 少一个依赖也就少一份构建体积和版本风险。
 *
 * 两个必须由 Redis 保证的点：
 * 1. **扣减原子**：用 Lua 脚本一次完成「全部校验 → 全部扣减」。
 *    分成 GET 再 DECRBY 会留出竞态窗口，两单能同时买到最后一件孤品。
 * 2. **回调幂等**：`SET key 1 NX EX 604800` 一条命令判定「是不是第一次」，
 *    不用「先查再写」。
 *
 * 库存键不存在时用商品数据里的 stock 播种（脚本里用 ARGV 后半段传种子值），
 * 这样线上第一次下单不会因为「键还没建」而全部缺货。
 */

const BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const K = {
  stock: (slug: string) => `mm:stock:${slug}`,
  order: (id: string) => `mm:order:${id}`,
  pay: (key: string) => `mm:pay:${key}`,
  outbox: "mm:mail:outbox",
};

async function redis<T>(body: unknown): Promise<T> {
  if (!BASE || !TOKEN) throw new Error("Upstash 未配置");
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Upstash ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { result?: T; error?: string };
  if (json.error) throw new Error(`Upstash: ${json.error}`);
  return json.result as T;
}

async function pipeline(commands: unknown[][]): Promise<unknown[]> {
  if (!BASE || !TOKEN) throw new Error("Upstash 未配置");
  const res = await fetch(`${BASE}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash pipeline ${res.status}`);
  const rows = (await res.json()) as { result?: unknown; error?: string }[];
  return rows.map((r) => (r.error ? null : (r.result ?? null)));
}

/** 全部校验通过才扣；任意一件不足则一件都不动 */
const RESERVE_LUA = `
local n = #KEYS
local qty = {}
for i = 1, n do
  qty[i] = tonumber(ARGV[i])
  local raw = redis.call('GET', KEYS[i])
  local cur = tonumber(raw)
  if cur == nil then cur = tonumber(ARGV[n + i]) end
  if cur < qty[i] then return {0, i, cur} end
end
for i = 1, n do
  local raw = redis.call('GET', KEYS[i])
  if raw == nil then
    redis.call('SET', KEYS[i], tostring(tonumber(ARGV[n + i]) - qty[i]))
  else
    redis.call('DECRBY', KEYS[i], qty[i])
  end
end
return {1, 0, 0}
`;

export const upstashStore: Store = {
  async reserveStock(items: ReserveItem[]): Promise<ReserveResult> {
    for (const item of items) {
      if (!getProductBySlug(item.slug)) {
        return { ok: false, slug: item.slug, reason: "unknown_product" };
      }
    }
    const keys = items.map((i) => K.stock(i.slug));
    const qtys = items.map((i) => String(i.qty));
    const seeds = items.map((i) => String(Math.max(0, getProductBySlug(i.slug)?.stock ?? 0)));
    const args = [RESERVE_LUA, String(keys.length), ...keys, ...qtys, ...seeds];

    const result = (await redis<number[]>(args)) ?? [0, 1, 0];
    if (Number(result[0]) === 1) return { ok: true };

    const idx = Number(result[1]) - 1;
    const failed = items[idx] ?? items[0];
    return { ok: false, slug: failed.slug, reason: "out_of_stock" };
  },

  async releaseStock(items: ReserveItem[]): Promise<void> {
    if (!items.length) return;
    await pipeline(items.map((i) => ["INCRBY", K.stock(i.slug), String(i.qty)]));
  },

  async readStock(slugs: string[]): Promise<StockSnapshot> {
    if (!slugs.length) return {};
    const rows = await pipeline(slugs.map((s) => ["GET", K.stock(s)]));
    const out: StockSnapshot = {};
    slugs.forEach((slug, i) => {
      const raw = rows[i];
      const fromRedis = raw === null || raw === undefined ? NaN : Number(raw);
      out[slug] = Number.isFinite(fromRedis)
        ? fromRedis
        : Math.max(0, getProductBySlug(slug)?.stock ?? 0);
    });
    return out;
  },

  async putOrder(order: Order): Promise<void> {
    await redis(["SET", K.order(order.id), JSON.stringify(order)]);
  },

  async getOrder(id: string, token: string): Promise<Order | null> {
    const raw = await redis<string | null>(["GET", K.order(id)]);
    if (!raw || !token) return null;
    try {
      const found = JSON.parse(raw) as Order;
      return found.accessToken === token ? found : null;
    } catch {
      return null;
    }
  },

  async updateOrderStatus(id: string, status: OrderStatus, token: string): Promise<Order | null> {
    const found = await this.getOrder(id, token);
    if (!found) return null;
    const next: Order = { ...found, status, updatedAt: new Date().toISOString() };
    await this.putOrder(next);
    return next;
  },

  async claimPaymentKey(key: string): Promise<boolean> {
    // NX：只有键不存在才写入成功，返回 "OK"；已存在返回 null
    const res = await redis<string | null>(["SET", K.pay(key), "1", "NX", "EX", String(60 * 60 * 24 * 7)]);
    return res === "OK";
  },

  async appendOutbox(entry): Promise<void> {
    await redis(["RPUSH", K.outbox, JSON.stringify({ ...entry, at: new Date().toISOString() })]);
    console.info(`[mail:outbox] ${entry.kind} → ${entry.to} · ${entry.subject}`);
  },
};

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
 * 内存实现（没有 Upstash 凭证时使用）
 *
 * 用途：本地开发、以及线上尚未配置 Redis 时的降级。
 * 局限说清楚：数据只在当前进程内，重新部署或扩到多实例就会丢。
 * 所以 UI 上会明确标注「演示模式」，绝不假装这是真实库存。
 */

const stock = new Map<string, number>();
const orders = new Map<string, Order>();
const paymentKeys = new Set<string>();
const outbox: { to: string; subject: string; html: string; text: string; kind: string }[] = [];

/** 首次访问时用商品数据里的 stock 播种，避免所有商品都"缺货" */
function seed(slug: string): number {
  if (stock.has(slug)) return stock.get(slug)!;
  const p = getProductBySlug(slug);
  const initial = p ? Math.max(0, p.stock) : 0;
  stock.set(slug, initial);
  return initial;
}

export const memoryStore: Store = {
  async reserveStock(items: ReserveItem[]): Promise<ReserveResult> {
    // 先全量校验再统一扣减：任意一件不够就一件都不动（否则会扣掉半单）
    for (const item of items) {
      if (!getProductBySlug(item.slug)) {
        return { ok: false, slug: item.slug, reason: "unknown_product" };
      }
      if (seed(item.slug) < item.qty) {
        return { ok: false, slug: item.slug, reason: "out_of_stock" };
      }
    }
    for (const item of items) {
      stock.set(item.slug, seed(item.slug) - item.qty);
    }
    return { ok: true };
  },

  async releaseStock(items: ReserveItem[]): Promise<void> {
    for (const item of items) {
      stock.set(item.slug, seed(item.slug) + item.qty);
    }
  },

  async readStock(slugs: string[]): Promise<StockSnapshot> {
    return Object.fromEntries(slugs.map((s) => [s, seed(s)]));
  },

  async putOrder(order: Order): Promise<void> {
    orders.set(order.id, order);
  },

  async getOrder(id: string, token: string): Promise<Order | null> {
    const found = orders.get(id);
    if (!found || !token || found.accessToken !== token) return null;
    return found;
  },

  async updateOrderStatus(id: string, status: OrderStatus, token: string): Promise<Order | null> {
    const found = orders.get(id);
    if (!found || !token || found.accessToken !== token) return null;
    const next = { ...found, status, updatedAt: new Date().toISOString() };
    orders.set(id, next);
    return next;
  },

  async claimPaymentKey(key: string): Promise<boolean> {
    if (paymentKeys.has(key)) return false;
    paymentKeys.add(key);
    return true;
  },

  async appendOutbox(entry): Promise<void> {
    outbox.push(entry);
    // 没有邮件服务商时至少让运维能在日志里看到"本该发出去什么"
    console.info(`[mail:outbox] ${entry.kind} → ${entry.to} · ${entry.subject}`);
  },
};

/** 仅供测试与排障：把内存账重置成商品数据的初始库存 */
export function resetMemoryStore(): void {
  stock.clear();
  orders.clear();
  paymentKeys.clear();
  outbox.length = 0;
}

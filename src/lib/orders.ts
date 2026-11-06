import { randomBytes, randomUUID } from "node:crypto";
import { getProductBySlug } from "@/lib/products";
import { localizeProduct } from "@/lib/types";
import { cartTotals, MAX_QTY_PER_LINE, type CartLine } from "@/lib/cart";
import { SHIPPING } from "@/lib/site";
import { getStore, type Order, type OrderLine, type ShipTo } from "@/lib/store";

/**
 * 下单业务逻辑（m-1c / 1c-1 + 1c-2）
 *
 * 安全口径：**价格、运费、库存一律服务端重算**，客户端送来的金额只当提示。
 * 否则任何人改一下请求体就能 1 美元买走孤品。
 *
 * 流程：校验 → 服务端重算金额 → 原子预占库存 → 落订单（status=created）
 * → 支付成功后置 paid（见 /api/pay）。预占失败就整单不成立，不留半截数据。
 */

export type CheckoutLineInput = {
  slug: string;
  qty: number;
  options?: { name: string; value: string }[];
};

export type CheckoutInput = {
  email: string;
  shipTo: ShipTo;
  lines: CheckoutLineInput[];
  notes?: string;
};

export type PlaceOrderResult =
  | { ok: true; order: Order }
  | {
      ok: false;
      code:
        | "empty_cart"
        | "invalid_email"
        | "invalid_address"
        | "unknown_product"
        | "qty_limit"
        | "out_of_stock"
        | "store_unavailable";
      slug?: string;
    };

/** 订单号：不含 0/O/1/I，念出来不会错 */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function orderId(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `MM-${out}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * 把请求体变成可信的订单行：数量夹紧、规格限定为字符串、
 * 价格与标题从服务端商品数据取（中文站下单时标题取中文，便于邮件与后台阅读）。
 */
export function resolveLines(input: CheckoutLineInput[], locale: "en" | "zh" = "en"):
  | { ok: true; lines: OrderLine[]; reserve: { slug: string; qty: number }[] }
  | { ok: false; code: "unknown_product" | "qty_limit" | "empty_cart"; slug?: string } {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, code: "empty_cart" };
  if (input.length > 20) return { ok: false, code: "qty_limit" };

  const lines: OrderLine[] = [];
  const reserve: { slug: string; qty: number }[] = [];

  for (const raw of input) {
    if (!raw || typeof raw.slug !== "string") return { ok: false, code: "unknown_product" };
    const found = getProductBySlug(raw.slug);
    if (!found) return { ok: false, code: "unknown_product", slug: raw.slug };

    const oneOfAKind = found.productType === "one_of_a_kind";
    const maxQty = oneOfAKind ? 1 : Math.max(1, Math.min(MAX_QTY_PER_LINE, found.stock));
    const qty = Math.floor(Number(raw.qty));
    if (!Number.isFinite(qty) || qty < 1) return { ok: false, code: "qty_limit", slug: raw.slug };
    if (qty > maxQty) return { ok: false, code: "qty_limit", slug: raw.slug };

    const product = localizeProduct(found, locale);
    const primary = found.images.find((i) => i.isPrimary) ?? found.images[0];

    lines.push({
      slug: found.slug,
      title: product.title,
      priceUsd: found.price,
      qty,
      options: Array.isArray(raw.options)
        ? raw.options
            .filter(
              (o) =>
                o &&
                typeof o.name === "string" &&
                typeof o.value === "string" &&
                o.name.length < 60 &&
                o.value.length < 120,
            )
            .slice(0, 6)
        : [],
      oneOfAKind,
      imageUrl: primary?.url ?? null,
    });
    reserve.push({ slug: found.slug, qty });
  }

  return { ok: true, lines, reserve };
}

function toCartLines(lines: OrderLine[]): CartLine[] {
  return lines.map((l) => ({
    key: l.slug,
    slug: l.slug,
    title: l.title,
    priceUsd: l.priceUsd,
    qty: l.qty,
    maxQty: l.qty,
    oneOfAKind: l.oneOfAKind,
    options: l.options,
    image: null,
  }));
}

export async function placeOrder(input: CheckoutInput, locale: "en" | "zh" = "en"): Promise<PlaceOrderResult> {
  const email = normalizeEmail(input.email ?? "");
  if (!EMAIL_RE.test(email)) return { ok: false, code: "invalid_email" };

  const addr = input.shipTo ?? ({} as ShipTo);
  const required: (keyof ShipTo)[] = ["name", "line1", "city", "postalCode", "country"];
  for (const field of required) {
    const v = addr[field];
    if (typeof v !== "string" || v.trim().length < 2) return { ok: false, code: "invalid_address" };
  }
  if (addr.country !== "US" && addr.country !== "CN") return { ok: false, code: "invalid_address" };

  const resolved = resolveLines(input.lines ?? [], locale);
  if (!resolved.ok) return { ok: false, code: resolved.code, slug: resolved.slug };

  const totals = cartTotals(toCartLines(resolved.lines));
  const store = getStore();

  let reserved: Awaited<ReturnType<typeof store.reserveStock>>;
  try {
    reserved = await store.reserveStock(resolved.reserve);
  } catch {
    return { ok: false, code: "store_unavailable" };
  }
  if (!reserved.ok) {
    return {
      ok: false,
      code: reserved.reason === "unknown_product" ? "unknown_product" : "out_of_stock",
      slug: reserved.slug,
    };
  }

  const now = new Date().toISOString();
  const order: Order = {
    id: orderId(),
    accessToken: randomUUID(),
    status: "created",
    shipTo: {
      name: addr.name.trim(),
      email,
      line1: addr.line1.trim(),
      line2: typeof addr.line2 === "string" ? addr.line2.trim().slice(0, 120) : undefined,
      city: addr.city.trim(),
      postalCode: addr.postalCode.trim(),
      country: addr.country,
      phone: typeof addr.phone === "string" ? addr.phone.trim().slice(0, 40) : undefined,
    },
    lines: resolved.lines,
    subtotalUsd: totals.subtotalUsd,
    shippingUsd: totals.shippingUsd,
    totalUsd: totals.totalUsd,
    taxIncluded: SHIPPING.taxIncluded,
    dutyPaid: SHIPPING.dutyPaid,
    createdAt: now,
    updatedAt: now,
    payment: {
      provider: "mock",
      reference: "",
      idempotencyKey: `mock_${randomUUID()}`,
    },
  };

  try {
    await store.putOrder(order);
  } catch {
    // 落单失败要把库存放回去，否则这几件货就被凭空锁死了
    await store.releaseStock(resolved.reserve).catch(() => {});
    return { ok: false, code: "store_unavailable" };
  }

  return { ok: true, order };
}

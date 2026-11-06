import { SHIPPING } from "./site";

/**
 * 购物袋数据模型与金额规则（m-1c / 1c-0 + 1c-5）
 *
 * 三条口径，必须全站一致：
 * 1. **价格一律以美元为基准**存，展示时再按当前币种换算（与 <Price> 同一套逻辑）。
 *    购物袋里如果存展示币种金额，用户切币种就会把历史条目算错。
 * 2. **运费在客户端算、在服务端复核**。客户端算为了即时反馈，服务端算为了不被改价——
 *    两处都调这里的 `cartTotals()`，不各写一套。
 * 3. **价含税（DDP）**：合计 = 小计 + 运费，不再加税；文案负责把「已含税、关税我方申报」讲清楚。
 */

/** 所选规格（尺码 / 开合方式），值已在加入时本地化，切语言不会变字 */
export type CartOption = { name: string; value: string };

export type CartLine = {
  /** 稳定主键：slug + 规格，同款不同规格是两行 */
  key: string;
  slug: string;
  title: string;
  priceUsd: number;
  qty: number;
  /** 可买上限：孤品恒为 1，可补货款按库存 */
  maxQty: number;
  /** 孤品标记：购物袋里要提示「只此一件，售出不再补货」 */
  oneOfAKind: boolean;
  options: CartOption[];
  image: { url: string; alt: string; width: number; height: number } | null;
};

/** localStorage 键名带版本：结构变更时直接丢弃旧数据，不做迁移（购物袋丢了比算错便宜） */
export const CART_STORAGE_KEY = "mm.cart.v1";
/** 单行上限：可补货款也别让一个人一次买走 30 件，手工商品产能有限 */
export const MAX_QTY_PER_LINE = 9;

/** 同款不同规格要能分开：规格参与 key */
export function lineKeyOf(slug: string, options: CartOption[]): string {
  if (!options.length) return slug;
  const sig = options
    .map((o) => `${o.name}=${o.value}`)
    .sort()
    .join("&");
  return `${slug}?${sig}`;
}

export function lineTotalUsd(line: CartLine): number {
  return Math.round(line.priceUsd * line.qty * 100) / 100;
}

export function cartItemCount(lines: CartLine[]): number {
  return lines.reduce((n, l) => n + l.qty, 0);
}

export type CartTotals = {
  subtotalUsd: number;
  shippingUsd: number;
  totalUsd: number;
  /** 离包邮还差多少（已包邮时为 0） */
  freeShippingRemainUsd: number;
  freeShippingReached: boolean;
  itemCount: number;
};

/**
 * 金额汇总。空袋也返回全 0（不返回 null）——页面上少一层判空分支。
 * 运费：满 `SHIPPING.freeShippingThreshold` 免，否则 `SHIPPING.flatRate`。
 */
export function cartTotals(lines: CartLine[]): CartTotals {
  const subtotalUsd =
    Math.round(lines.reduce((s, l) => s + lineTotalUsd(l), 0) * 100) / 100;
  const threshold = SHIPPING.freeShippingThreshold;
  const reached = lines.length > 0 && subtotalUsd >= threshold;
  const shippingUsd = lines.length === 0 || reached ? 0 : SHIPPING.flatRate;

  return {
    subtotalUsd,
    shippingUsd,
    totalUsd: Math.round((subtotalUsd + shippingUsd) * 100) / 100,
    freeShippingRemainUsd:
      lines.length === 0 || reached
        ? 0
        : Math.max(0, Math.round((threshold - subtotalUsd) * 100) / 100),
    freeShippingReached: reached,
    itemCount: cartItemCount(lines),
  };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * 反序列化防线：localStorage 是用户可编辑的，脏数据不能直接进渲染。
 * 任何一条不合法就整条丢弃，且把数量夹回 [1, maxQty]、价格夹到非负。
 */
export function sanitizeCart(raw: unknown): CartLine[] {
  if (!Array.isArray(raw)) return [];
  const out: CartLine[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.slug !== "string" || typeof o.title !== "string") continue;
    if (!isNum(o.priceUsd) || o.priceUsd < 0) continue;
    if (typeof o.key !== "string") continue;

    const maxQty = isNum(o.maxQty) ? Math.max(1, Math.min(MAX_QTY_PER_LINE, Math.floor(o.maxQty))) : 1;
    const qty = isNum(o.qty) ? Math.max(1, Math.min(maxQty, Math.floor(o.qty))) : 1;

    const options = Array.isArray(o.options)
      ? o.options
          .filter(
            (x): x is CartOption =>
              !!x &&
              typeof x === "object" &&
              typeof (x as CartOption).name === "string" &&
              typeof (x as CartOption).value === "string",
          )
          .slice(0, 6)
      : [];

    const img = o.image as Record<string, unknown> | null | undefined;
    const image =
      img && typeof img.url === "string"
        ? {
            url: img.url,
            alt: typeof img.alt === "string" ? img.alt : "",
            width: isNum(img.width) ? img.width : 1024,
            height: isNum(img.height) ? img.height : 1178,
          }
        : null;

    out.push({
      key: o.key,
      slug: o.slug,
      title: o.title,
      priceUsd: o.priceUsd,
      qty,
      maxQty,
      oneOfAKind: o.oneOfAKind === true,
      options,
      image,
    });
  }

  // 同一 key 出现多次（用户手改或旧版本残留）时合并数量，不叠加出重复行
  const merged = new Map<string, CartLine>();
  for (const line of out) {
    const prev = merged.get(line.key);
    if (!prev) {
      merged.set(line.key, line);
      continue;
    }
    const qty = Math.min(prev.maxQty, prev.qty + line.qty);
    merged.set(line.key, { ...prev, qty });
  }
  return [...merged.values()];
}

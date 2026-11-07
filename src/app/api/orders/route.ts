import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { getProductBySlug } from "@/lib/products";
import { MAX_ORDER_HISTORY } from "@/lib/order-history";
import type { OrderStatus } from "@/lib/store/types";

/**
 * 「我的订单」批量取状态（0.4.2）
 *
 * 前端只送来本机保存的 { id, token }，服务端逐条用 `getStore().getOrder(id, token)`
 * 校验口令后再返回**摘要**。这一步是必须的：localStorage 可以被手改，
 * 不能因为前端声称「我有这个订单」就返回内容；口令不对 / 订单不存在一律跳过。
 *
 * 返回里不含 token、不含收货地址与邮箱——列表页只需要状态、金额、件数，
 * 以及逐件商品的标题/缩略图/在售 slug，少给一分数据就少一分泄露面。单条查询失败不影响其他订单。
 */
export type OrderSummary = {
  id: string;
  status: OrderStatus;
  createdAt: string;
  totalUsd: number;
  itemCount: number;
  /** 0.4.7：逐件商品明细，供列表页渲染缩略图 + 标题。仍是摘要，不含地址/邮箱/口令 */
  items: {
    /** 0.4.8：仅当商品仍在目录中才回传，列表页据此决定是否给详情页链接 */
    slug: string;
    title: string;
    imageUrl: string | null;
    qty: number;
    options: { name: string; value: string }[];
  }[];
};

const ID_RE = /^[A-Za-z0-9_-]{3,40}$/;
const TOKEN_RE = /^[A-Za-z0-9._~-]{16,200}$/;
/** 商品 slug 只可能是小写字母数字 + 连字符；挡住脏数据拼出外链或奇怪路径 */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  }

  const list = (body as { orders?: unknown } | null)?.orders;
  if (!Array.isArray(list)) {
    return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  }
  if (list.length > MAX_ORDER_HISTORY) {
    return NextResponse.json({ ok: false, code: "too_many" }, { status: 400 });
  }

  const store = getStore();
  const out: OrderSummary[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { id, token } = item as { id?: unknown; token?: unknown };
    if (typeof id !== "string" || !ID_RE.test(id)) continue;
    if (typeof token !== "string" || !TOKEN_RE.test(token)) continue;

    try {
      const order = await store.getOrder(id, token);
      if (!order) continue;
      // 0.4.7：把订单快照里的每一件商品交给列表页画小图。
      // 图片只认本站 /images/ 下的静态文件名：订单是历史数据，不能让一个被改过的
      // imageUrl 把页面变成外链图片加载器。字段一律夹紧，避免脏数据撑爆卡片。
      const items = order.lines.slice(0, 20).map((l) => ({
        // 0.4.8：slug 既要格式合法、又要仍在商品目录里，才允许列表页生成详情页链接。
        // 历史订单里的商品若已下架，slug 留空 → 该行退化为纯文本，不制造 404 死链。
        slug:
          typeof l.slug === "string" && SLUG_RE.test(l.slug) && getProductBySlug(l.slug)
            ? l.slug
            : "",
        title: String(l.title ?? "").slice(0, 120),
        imageUrl:
          typeof l.imageUrl === "string" &&
          /^\/images\/[A-Za-z0-9._-]+\.(jpe?g|png)$/i.test(l.imageUrl)
            ? l.imageUrl
            : null,
        qty: Number.isFinite(l.qty) ? Math.max(1, Math.floor(l.qty)) : 1,
        options: (Array.isArray(l.options) ? l.options : []).slice(0, 6).map((o) => ({
          name: String(o?.name ?? "").slice(0, 60),
          value: String(o?.value ?? "").slice(0, 120),
        })),
      }));

      out.push({
        id: order.id,
        status: order.status,
        createdAt: order.createdAt,
        totalUsd: order.totalUsd,
        itemCount: order.lines.reduce((n, l) => n + l.qty, 0),
        items,
      });
    } catch {
      // 某一条查不动（网络抖动 / 存储暂不可用）不影响其余订单展示
    }
  }

  return NextResponse.json(
    { ok: true, orders: out },
    { headers: { "Cache-Control": "no-store" } },
  );
}

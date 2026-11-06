import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { MAX_ORDER_HISTORY } from "@/lib/order-history";
import type { OrderStatus } from "@/lib/store/types";

/**
 * 「我的订单」批量取状态（0.4.2）
 *
 * 前端只送来本机保存的 { id, token }，服务端逐条用 `getStore().getOrder(id, token)`
 * 校验口令后再返回**摘要**。这一步是必须的：localStorage 可以被手改，
 * 不能因为前端声称「我有这个订单」就返回内容；口令不对 / 订单不存在一律跳过。
 *
 * 返回里不含 token、不含收货地址与邮箱——列表页只需要状态、金额、件数和商品名，
 * 少给一分数据就少一分泄露面。单条查询失败不影响其他订单。
 */
export type OrderSummary = {
  id: string;
  status: OrderStatus;
  createdAt: string;
  totalUsd: number;
  itemCount: number;
  firstTitle: string;
};

const ID_RE = /^[A-Za-z0-9_-]{3,40}$/;
const TOKEN_RE = /^[A-Za-z0-9._~-]{16,200}$/;

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
      out.push({
        id: order.id,
        status: order.status,
        createdAt: order.createdAt,
        totalUsd: order.totalUsd,
        itemCount: order.lines.reduce((n, l) => n + l.qty, 0),
        firstTitle: order.lines[0]?.title ?? "",
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

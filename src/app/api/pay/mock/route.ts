import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { renderOrderMail } from "@/lib/email";
import type { Order } from "@/lib/store";

/**
 * 模拟支付回调（m-1c / 1c-1）
 *
 * 真实支付商（Stripe/PayPal）到位前，用这个端点把「成功 / 失败 / 取消」三条路径跑通，
 * 让下单 → 扣库存 → 订单状态 → 邮件模板 的整条链路可以真机验收。
 *
 * 三条纪律（与真实网关一致，换 provider 时不用改业务）：
 * 1. **幂等**：同一笔支付的回调重复到达只生效一次（claimPaymentKey）。
 * 2. **校验归属性**：必须拿到该订单的 accessToken 才能动它的状态。
 * 3. **不静默失败**：写订单/发信出错要回 5xx，让调用方知道没成。
 */

type Body = { orderId?: string; token?: string; outcome?: "success" | "failure" | "cancel" };

async function sendMail(order: Order, kind: "order_paid" | "order_cancelled") {
  const mail = renderOrderMail(kind, order);
  await getStore().appendOutbox({
    to: order.shipTo.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    kind,
  });
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  }

  const { orderId, token, outcome } = body;
  if (!orderId || !token || !outcome) {
    return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  }
  if (!["success", "failure", "cancel"].includes(outcome)) {
    return NextResponse.json({ ok: false, code: "bad_outcome" }, { status: 400 });
  }

  const store = getStore();
  let order: Order | null;
  try {
    // 口令校验在存储层做；口令不对与订单不存在返回同一个 null，
    // 不区分二者，避免被拿来探测订单号
    order = await store.getOrder(orderId, token);
  } catch {
    return NextResponse.json({ ok: false, code: "store_unavailable" }, { status: 503 });
  }
  if (!order) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404 });

  // 幂等键带 outcome：同一笔「成功」重复回调只算一次，
  // 但如果先失败后成功（用户重试支付），仍然要能推进到 paid
  const idempotencyKey = `${order.id}:${outcome}`;
  let firstTime: boolean;
  try {
    firstTime = await store.claimPaymentKey(idempotencyKey);
  } catch {
    return NextResponse.json({ ok: false, code: "store_unavailable" }, { status: 503 });
  }
  if (!firstTime) {
    return NextResponse.json({ ok: true, status: order.status, replay: true });
  }

  try {
    if (outcome === "success") {
      // 已付款的单不再重复发货逻辑；直接返回当前状态
      if (order.status === "paid" || order.status === "fulfilled") {
        return NextResponse.json({ ok: true, status: order.status, replay: true });
      }
      const next = await store.updateOrderStatus(order.id, "paid", token);
      if (!next) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404 });
      await sendMail(next, "order_paid");
      return NextResponse.json({ ok: true, status: next.status });
    }

    // 失败 / 取消：回补库存（未发货取消回补，见 04 四事件表），订单置 cancelled
    if (order.status === "cancelled") {
      return NextResponse.json({ ok: true, status: order.status, replay: true });
    }
    await store.releaseStock(order.lines.map((l) => ({ slug: l.slug, qty: l.qty })));
    const next = await store.updateOrderStatus(order.id, "cancelled", token);
    if (!next) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404 });
    await sendMail(next, "order_cancelled");
    return NextResponse.json({ ok: true, status: next.status });
  } catch {
    return NextResponse.json({ ok: false, code: "store_unavailable" }, { status: 503 });
  }
}

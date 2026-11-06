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

  // 0.4.6 状态机守卫：支付动作只接受 created（待付款）订单。
  // 已付款/已发货 → 幂等返回，不重复发信也不改状态；
  // 已取消/已退款 → 终态，绝不能「复活」成 paid：取消时库存已回补，
  // 再标成已付款就会得到一笔「付了钱却没占库存」的单。
  // 放在 claimPaymentKey 之前，被拒绝的请求不会白占幂等键。
  if (order.status === "paid" || order.status === "fulfilled") {
    return NextResponse.json({ ok: true, status: order.status, replay: true });
  }
  if (order.status === "cancelled" || order.status === "refunded") {
    return NextResponse.json(
      { ok: false, code: "order_closed", status: order.status },
      { status: 409 },
    );
  }

  // 幂等键带 outcome：同一结果的重复回调只算一次。
  // 注意：失败/取消会把订单置为终态 cancelled，之后不能再「成功付款」——
  // 前置守卫会拦下，避免取消后库存已回补却出现一笔 paid 单。
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
      // 走到这里 order.status 必然是 created（前置守卫已把其余状态挡掉）
      const next = await store.updateOrderStatus(order.id, "paid", token);
      if (!next) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404 });
      await sendMail(next, "order_paid");
      return NextResponse.json({ ok: true, status: next.status });
    }

    // 失败 / 取消：回补库存（未发货取消回补，见 04 四事件表），订单置 cancelled。
    // 前置守卫保证这里只可能是 created 单，不会重复回补库存。
    await store.releaseStock(order.lines.map((l) => ({ slug: l.slug, qty: l.qty })));
    const next = await store.updateOrderStatus(order.id, "cancelled", token);
    if (!next) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404 });
    await sendMail(next, "order_cancelled");
    return NextResponse.json({ ok: true, status: next.status });
  } catch {
    return NextResponse.json({ ok: false, code: "store_unavailable" }, { status: 503 });
  }
}

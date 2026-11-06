import { NextResponse } from "next/server";
import { placeOrder, type CheckoutInput } from "@/lib/orders";

/**
 * 下单（m-1c / 1c-1 + 1c-2）
 *
 * 一律 POST，一律服务端重算金额；客户端送来的总额不参与计算。
 * 返回里只给 orderId 与 accessToken，不给完整订单——
 * 让用户必须通过确认页看明细，避免有人拿接口当"订单查询器"扫号。
 */
export async function POST(req: Request) {
  let body: (CheckoutInput & { locale?: "en" | "zh" }) | null = null;
  try {
    body = (await req.json()) as CheckoutInput & { locale?: "en" | "zh" };
  } catch {
    return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  }
  if (!body) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

  const result = await placeOrder(body, body.locale === "zh" ? "zh" : "en");

  if (!result.ok) {
    const status =
      result.code === "store_unavailable"
        ? 503
        : result.code === "out_of_stock"
          ? 409
          : 400;
    return NextResponse.json({ ok: false, code: result.code, slug: result.slug }, { status });
  }

  return NextResponse.json({
    ok: true,
    orderId: result.order.id,
    token: result.order.accessToken,
    totalUsd: result.order.totalUsd,
  });
}

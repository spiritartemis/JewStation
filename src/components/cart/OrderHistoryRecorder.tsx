"use client";

import { useEffect } from "react";
import { recordOrder } from "@/lib/order-history";

/**
 * 把「订单号 + 口令」登记到本机清单（0.4.2）
 *
 * 只在服务端已经校验过口令的页面里挂载（确认页 / 支付页）：
 * 无效的链接不会写进清单，伪造的凭据也换不到任何订单内容。
 * 这样即便用户是拿邮件里的旧链接直接打开、没经过本机的下单流程，
 * 「我的订单」里也能看到这一单。
 */
export function OrderHistoryRecorder({ id, token }: { id: string; token: string }) {
  useEffect(() => {
    if (id && token) recordOrder(id, token);
  }, [id, token]);
  return null;
}

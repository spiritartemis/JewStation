"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/**
 * 模拟支付动作（m-1c / 1c-1）
 *
 * 三条路径都要能走：成功 → 订单 paid + 确认邮件；失败 / 取消 → 订单 cancelled + 库存回补。
 * 真实网关接入时，这个组件会被替换成支付商托管页/组件，页面其余部分不用动。
 */
export function PayActions({
  orderId,
  token,
  locale,
}: {
  orderId: string;
  token: string;
  locale: Locale;
}) {
  const m = getMessages(locale);
  const router = useRouter();
  const [busy, setBusy] = useState<null | "success" | "failure" | "cancel">(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (outcome: "success" | "failure" | "cancel") => {
    if (busy) return;
    setBusy(outcome);
    setError(null);
    try {
      const res = await fetch("/api/pay/mock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, token, outcome }),
      });
      if (!res.ok) {
        // 0.4.6：订单在别处已被取消/付款时，服务端返回 order_closed，
        // 要告诉用户「这笔单不能再付了」，而不是笼统的「请再试一次」。
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        setError(body.code === "order_closed" ? m.pay.errClosed : m.pay.errFailed);
        setBusy(null);
        return;
      }
      router.push(
        `${localePath(locale, `/orders/${orderId}`)}?token=${encodeURIComponent(token)}`,
      );
    } catch {
      setError(m.pay.errFailed);
      setBusy(null);
    }
  };

  const base = "h-12 w-full rounded-btn text-body transition-opacity";
  const disabled = busy !== null;

  return (
    <div className="mt-sp5 space-y-sp2">
      <button
        type="button"
        onClick={() => run("success")}
        disabled={disabled}
        className={`${base} bg-accent text-onAccent disabled:opacity-50`}
      >
        {busy === "success" ? m.pay.processing : m.pay.payNow}
      </button>
      <button
        type="button"
        onClick={() => run("failure")}
        disabled={disabled}
        className={`${base} border border-line text-ink disabled:opacity-50`}
      >
        {busy === "failure" ? m.pay.processing : m.pay.failNow}
      </button>
      <button
        type="button"
        onClick={() => run("cancel")}
        disabled={disabled}
        className={`${base} border border-line text-muted disabled:opacity-50`}
      >
        {busy === "cancel" ? m.pay.processing : m.pay.cancelNow}
      </button>

      {error ? (
        <p role="alert" className="text-body text-sold">
          {error}
        </p>
      ) : null}
    </div>
  );
}

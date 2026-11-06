import type { Order } from "@/lib/store";
import { SITE, SHIPPING } from "@/lib/site";

/**
 * 交易邮件模板（m-1c / 1c-4）
 *
 * 三类：下单确认（支付成功）、发货通知、退款/取消。
 * 每类都同时产 HTML 与纯文本 —— 只发 HTML 会让一部分邮件客户端显示成空白，
 * 只发纯文本又显得不像正规商家，两者都给才对。
 *
 * 邮件 HTML 的写法与网页不同：不能用外部样式表、不能用 flex/grid，
 * 这里一律内联 style + 表格布局思维，保证 Gmail / Outlook 里不塌。
 */

export type MailKind = "order_paid" | "order_shipped" | "order_cancelled" | "order_refunded";

export type RenderedMail = { subject: string; html: string; text: string };

const money = (usd: number) => `$${usd.toFixed(2)}`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function lineRows(order: Order, withPrice: boolean): string {
  return order.lines
    .map((l) => {
      const opts = l.options.length
        ? `<div style="color:#6b6660;font-size:13px;margin-top:2px">${l.options
            .map((o) => escapeHtml(`${o.name}: ${o.value}`))
            .join(" · ")}</div>`
        : "";
      return `<tr>
  <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;color:#232120">
    ${escapeHtml(l.title)} × ${l.qty}${opts}
  </td>
  ${
    withPrice
      ? `<td align="right" style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;color:#232120;white-space:nowrap">${money(
          l.priceUsd * l.qty,
        )}</td>`
      : ""
  }
</tr>`;
    })
    .join("");
}

function totalsRows(order: Order): string {
  return `<tr><td style="padding-top:10px;font-size:13px;color:#6b6660">Subtotal</td><td align="right" style="padding-top:10px;font-size:13px;color:#232120">${money(order.subtotalUsd)}</td></tr>
<tr><td style="font-size:13px;color:#6b6660">Shipping</td><td align="right" style="font-size:13px;color:#232120">${
    order.shippingUsd === 0 ? "Free" : money(order.shippingUsd)
  }</td></tr>
<tr><td style="padding-top:6px;font-size:15px;color:#232120"><strong>Total</strong></td><td align="right" style="padding-top:6px;font-size:15px;color:#232120"><strong>${money(
    order.totalUsd,
  )}</strong></td></tr>`;
}

function shell(title: string, body: string, footerNote: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f1eb">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1eb;padding:24px 12px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;padding:28px 24px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
      <tr><td style="font-family:Georgia,serif;font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#8a837b;padding-bottom:18px">${escapeHtml(
        SITE.brandName,
      )}</td></tr>
      <tr><td style="font-family:Georgia,serif;font-size:22px;color:#232120;padding-bottom:12px">${escapeHtml(
        title,
      )}</td></tr>
      ${body}
      <tr><td style="padding-top:22px;font-size:12px;color:#8a837b;line-height:1.6">${footerNote}</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export function renderOrderMail(kind: MailKind, order: Order): RenderedMail {
  const shipLine = `${escapeHtml(order.shipTo.name)} · ${escapeHtml(order.shipTo.line1)}${
    order.shipTo.line2 ? `, ${escapeHtml(order.shipTo.line2)}` : ""
  } · ${escapeHtml(order.shipTo.city)} ${escapeHtml(order.shipTo.postalCode)} · ${order.shipTo.country}`;

  const shippingNote = `Shipping from ${SHIPPING.from} · ${SHIPPING.processingDays[0]}–${
    SHIPPING.processingDays[1]
  } days processing + ${SHIPPING.transitDays[0]}–${SHIPPING.transitDays[1]} days in transit. Prices include tax; duties are paid by us (DDP).`;

  if (kind === "order_paid") {
    const body = `
<tr><td style="font-size:14px;color:#4a4540;line-height:1.6;padding-bottom:14px">
  Thank you — your order is confirmed and we are getting it ready.<br>
  Order <strong>${order.id}</strong>
</td></tr>
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lineRows(
      order,
      true,
    )}${totalsRows(order)}</table></td></tr>
<tr><td style="padding-top:18px;font-size:13px;color:#6b6660;line-height:1.6">Ships to: ${shipLine}</td></tr>
<tr><td style="padding-top:10px;font-size:13px;color:#6b6660;line-height:1.6">${escapeHtml(
      shippingNote,
    )}</td></tr>`;

    const text = [
      `${SITE.brandName} — order confirmed`,
      ``,
      `Order ${order.id}`,
      ``,
      ...order.lines.map(
        (l) =>
          `${l.title} × ${l.qty}${l.options.length ? ` (${l.options.map((o) => `${o.name}: ${o.value}`).join(", ")})` : ""} — ${money(
            l.priceUsd * l.qty,
          )}`,
      ),
      ``,
      `Subtotal ${money(order.subtotalUsd)}`,
      `Shipping ${order.shippingUsd === 0 ? "Free" : money(order.shippingUsd)}`,
      `Total ${money(order.totalUsd)}`,
      ``,
      `Ships to: ${order.shipTo.name}, ${order.shipTo.line1}${
        order.shipTo.line2 ? `, ${order.shipTo.line2}` : ""
      }, ${order.shipTo.city} ${order.shipTo.postalCode}, ${order.shipTo.country}`,
      shippingNote,
    ].join("\n");

    return {
      subject: `Order ${order.id} confirmed — ${SITE.brandName}`,
      html: shell("Your order is confirmed", body, escapeHtml(shippingNote)),
      text,
    };
  }

  if (kind === "order_shipped") {
    const body = `
<tr><td style="font-size:14px;color:#4a4540;line-height:1.6;padding-bottom:14px">
  Order <strong>${order.id}</strong> is on its way.<br>
  ${SHIPPING.transitDays[0]}–${SHIPPING.transitDays[1]} days in transit from ${SHIPPING.from}.
</td></tr>
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lineRows(
      order,
      false,
    )}</table></td></tr>
<tr><td style="padding-top:18px;font-size:13px;color:#6b6660;line-height:1.6">Ships to: ${shipLine}</td></tr>`;

    const text = [
      `${SITE.brandName} — order ${order.id} shipped`,
      ``,
      ...order.lines.map((l) => `${l.title} × ${l.qty}`),
      ``,
      `Ships to: ${order.shipTo.name}, ${order.shipTo.line1}, ${order.shipTo.city} ${order.shipTo.postalCode}, ${order.shipTo.country}`,
      `${SHIPPING.transitDays[0]}–${SHIPPING.transitDays[1]} days in transit from ${SHIPPING.from}.`,
    ].join("\n");

    return {
      subject: `Order ${order.id} has shipped — ${SITE.brandName}`,
      html: shell("Your order has shipped", body, escapeHtml(shippingNote)),
      text,
    };
  }

  const cancelled = kind === "order_cancelled";
  const title = cancelled ? "Your order was cancelled" : "Your refund is on its way";
  const lead = cancelled
    ? `Order <strong>${order.id}</strong> has been cancelled. Nothing was shipped and the pieces are back in stock.`
    : `Order <strong>${order.id}</strong> has been refunded. Depending on your bank, the money usually appears within 5–10 business days.`;

  const body = `
<tr><td style="font-size:14px;color:#4a4540;line-height:1.6;padding-bottom:14px">${lead}</td></tr>
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lineRows(
    order,
    true,
  )}${totalsRows(order)}</table></td></tr>`;

  const text = [
    `${SITE.brandName} — ${title}`,
    ``,
    cancelled ? `Order ${order.id} cancelled.` : `Order ${order.id} refunded.`,
    ...order.lines.map((l) => `${l.title} × ${l.qty}`),
    ``,
    `Total ${money(order.totalUsd)}`,
  ].join("\n");

  return {
    subject: `${title} — ${SITE.brandName} (${order.id})`,
    html: shell(title, body, "Questions? Just reply to this email."),
    text,
  };
}

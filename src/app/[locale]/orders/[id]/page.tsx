import type { Metadata } from "next";
import Link from "next/link";
import { Price } from "@/components/currency/Price";
import { OrderHistoryRecorder } from "@/components/cart/OrderHistoryRecorder";
import { getStore, isEphemeralStore, type OrderStatus } from "@/lib/store";
import { buildMetadata } from "@/lib/seo";
import { DEFAULT_LOCALE, isLocale, localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/**
 * 订单确认页（m-1c / 1c-3）
 *
 * 访问控制：链接里必须带 `token`，且与订单上的 accessToken 一致才显示明细。
 * 只靠订单号不安全（MM-XXXXXX 是可猜的空间），只靠邮箱也会泄露「某邮箱买过什么」。
 *
 * 必须动态渲染：订单状态会变（待支付 → 已支付 → 已发货 / 已取消），不能静态化。
 * 该页 noindex —— 订单内容属于私人信息，不该出现在搜索结果里。
 */
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ token?: string }>;
};

function resolve(locale: string): Locale {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = resolve(raw);
  const m = getMessages(locale);
  return buildMetadata({
    title: m.order.metaTitle,
    description: m.order.title,
    path: "/cart",
    locale,
    noindex: true,
  });
}

const statusLabelKey: Record<OrderStatus, "statusCreated" | "statusPaid" | "statusFulfilled" | "statusCancelled" | "statusRefunded"> = {
  created: "statusCreated",
  paid: "statusPaid",
  fulfilled: "statusFulfilled",
  cancelled: "statusCancelled",
  refunded: "statusRefunded",
};

export default async function OrderPage({ params, searchParams }: PageProps) {
  const { locale: raw, id } = await params;
  const { token } = await searchParams;
  const locale = resolve(raw);
  const m = getMessages(locale);

  let order = null;
  try {
    // 口令校验在存储层完成（云端是数据库函数里做），口令不对与订单不存在返回同一个 null
    order = await getStore().getOrder(id, token ?? "");
  } catch {
    order = null;
  }

  if (!order) {
    return (
      <div className="shell py-sp7 text-center">
        <h1 className="font-serif text-h1 text-ink">{m.order.notFoundTitle}</h1>
        <p className="mx-auto mt-sp3 max-w-[46ch] text-body text-muted">{m.order.notFoundBody}</p>
        <Link
          href={localePath(locale, "/shop")}
          className="mt-sp5 inline-flex h-12 items-center justify-center rounded-btn bg-accent px-sp6 text-body text-onAccent"
        >
          {m.order.continueShopping}
        </Link>
      </div>
    );
  }

  const lead =
    order.status === "paid" || order.status === "fulfilled"
      ? m.order.paidLead
      : order.status === "cancelled" || order.status === "refunded"
        ? m.order.cancelledLead
        : m.order.pendingLead;

  const placed = new Date(order.createdAt);
  const placedLabel = Number.isNaN(placed.getTime())
    ? order.createdAt
    : placed.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

  return (
    <div className="shell max-w-[720px] py-sp6">
      <h1 className="font-serif text-h1 text-ink">{m.order.title}</h1>
      <p className="mt-sp3 text-body text-muted">{lead}</p>

      <dl className="mt-sp5 grid gap-sp2 rounded-card border border-line bg-surface p-sp4 text-body sm:grid-cols-2">
        <div>
          <dt className="text-aux text-muted">{m.order.number}</dt>
          <dd className="text-ink">{order.id}</dd>
        </div>
        <div>
          <dt className="text-aux text-muted">{m.order.status}</dt>
          <dd className="text-ink">{m.order[statusLabelKey[order.status]]}</dd>
        </div>
        <div>
          <dt className="text-aux text-muted">{m.order.placedOn}</dt>
          <dd className="text-ink">{placedLabel}</dd>
        </div>
        <div>
          <dt className="text-aux text-muted">{m.order.contact}</dt>
          <dd className="text-ink">{order.shipTo.email}</dd>
        </div>
      </dl>

      <section className="mt-sp5">
        <h2 className="text-h2 text-ink">{m.order.items}</h2>
        <ul className="mt-sp3 divide-y divide-line border-y border-line">
          {order.lines.map((line) => (
            <li key={`${line.slug}-${line.options.map((o) => o.value).join("-")}`} className="flex justify-between gap-sp3 py-sp3">
              <div className="min-w-0">
                <p className="text-body text-ink">{line.title}</p>
                {line.options.length ? (
                  <p className="mt-sp1 text-aux text-muted">
                    {line.options.map((o) => `${o.name}: ${o.value}`).join(" · ")}
                  </p>
                ) : null}
                <p className="mt-sp1 text-aux text-muted">× {line.qty}</p>
              </div>
              <Price usd={line.priceUsd * line.qty} className="shrink-0 text-body text-ink" />
            </li>
          ))}
        </ul>

        <dl className="mt-sp3 space-y-sp2 text-body">
          <div className="flex justify-between">
            <dt className="text-muted">{m.cart.subtotal}</dt>
            <dd>
              <Price usd={order.subtotalUsd} className="text-ink" />
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{m.cart.shipping}</dt>
            <dd>
              {order.shippingUsd === 0 ? (
                <span className="text-ink">{m.cart.freeShipping}</span>
              ) : (
                <Price usd={order.shippingUsd} className="text-ink" />
              )}
            </dd>
          </div>
          <div className="flex justify-between border-t border-line pt-sp2">
            <dt className="text-ink">{m.cart.total}</dt>
            <dd>
              <Price usd={order.totalUsd} className="text-h2 text-ink" />
            </dd>
          </div>
        </dl>
        <p className="mt-sp2 text-aux text-muted">{m.cart.taxNote}</p>
      </section>

      <section className="mt-sp5">
        <h2 className="text-h2 text-ink">{m.order.shipTo}</h2>
        <address className="mt-sp2 text-body not-italic text-muted">
          {order.shipTo.name}
          <br />
          {order.shipTo.line1}
          {order.shipTo.line2 ? (
            <>
              <br />
              {order.shipTo.line2}
            </>
          ) : null}
          <br />
          {order.shipTo.city} {order.shipTo.postalCode}
          <br />
          {order.shipTo.country === "CN" ? m.checkout.countryCN : m.checkout.countryUS}
          {order.shipTo.phone ? (
            <>
              <br />
              {order.shipTo.phone}
            </>
          ) : null}
        </address>
      </section>

      {isEphemeralStore() ? (
        <p className="mt-sp5 rounded-btn bg-accentWeak px-sp3 py-sp2 text-aux text-ink">
          {locale === "zh"
            ? "演示模式：这笔订单存在进程内存里，重新部署后会查不到。"
            : "Demo mode: this order is held in process memory and will disappear on redeploy."}
        </p>
      ) : null}

      <div className="mt-sp5 flex flex-wrap gap-sp3">
        <Link
          href={localePath(locale, "/shop")}
          className="inline-flex h-12 items-center justify-center rounded-btn border border-accent px-sp6 text-body text-ink hover:bg-accentWeak"
        >
          {m.order.continueShopping}
        </Link>
        <Link
          href={localePath(locale, "/orders")}
          className="inline-flex h-12 items-center justify-center rounded-btn border border-line px-sp6 text-body text-muted hover:bg-accentWeak hover:text-ink"
        >
          {m.nav.orders}
        </Link>
      </div>

      {/* 口令已由服务端校验过，才把这笔订单登记进「我的订单」 */}
      <OrderHistoryRecorder id={order.id} token={order.accessToken} />
    </div>
  );
}

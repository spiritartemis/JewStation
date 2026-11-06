import type { Metadata } from "next";
import Link from "next/link";
import { PayActions } from "@/components/cart/PayActions";
import { OrderHistoryRecorder } from "@/components/cart/OrderHistoryRecorder";
import { Price } from "@/components/currency/Price";
import { getStore, isEphemeralStore } from "@/lib/store";
import { buildMetadata } from "@/lib/seo";
import { DEFAULT_LOCALE, isLocale, localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/**
 * 支付页（m-1c / 1c-1）
 *
 * 真实服务商接入前，用这一页跑「成功 / 失败 / 取消」三条路径（12 §2 的工程硬要求）。
 * 页面必须动态渲染：订单状态每次都要重新读，不能走缓存。
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
    title: m.pay.metaTitle,
    description: m.pay.title,
    path: "/checkout",
    locale,
    noindex: true,
  });
}

export default async function PayPage({ params, searchParams }: PageProps) {
  const { locale: raw, id } = await params;
  const { token } = await searchParams;
  const locale = resolve(raw);
  const m = getMessages(locale);

  let order = null;
  try {
    order = await getStore().getOrder(id, token ?? "");
  } catch {
    order = null;
  }

  // 订单不存在 / 口令不对：一律同样的回应，不透露订单号是否有效
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

  return (
    <div className="shell max-w-[560px] py-sp6">
      <p className="text-aux uppercase tracking-[0.16em] text-muted">{m.pay.title}</p>
      <h1 className="mt-sp2 font-serif text-h1 text-ink">
        {order.id} · <Price usd={order.totalUsd} className="text-h1 text-ink" />
      </h1>

      <p className="mt-sp3 text-body text-muted">{m.pay.explain}</p>

      {isEphemeralStore() ? (
        <p className="mt-sp3 rounded-btn bg-accentWeak px-sp3 py-sp2 text-aux text-ink">
          {locale === "zh"
            ? "当前是演示模式：订单存在进程内存里，重新部署会清空。"
            : "Demo mode: orders live in process memory and are cleared on redeploy."}
        </p>
      ) : null}

      <PayActions orderId={order.id} token={order.accessToken} locale={locale} />

      <Link
        href={localePath(locale, "/orders")}
        className="mt-sp5 block text-center text-aux text-muted underline hover:text-accent"
      >
        {m.nav.orders}
      </Link>

      {/* 口令已由服务端校验过，才把这笔订单登记进「我的订单」 */}
      <OrderHistoryRecorder id={order.id} token={order.accessToken} />
    </div>
  );
}

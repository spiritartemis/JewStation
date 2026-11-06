import type { Metadata } from "next";
import { OrdersView } from "@/components/cart/OrdersView";
import { buildMetadata } from "@/lib/seo";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/** 订单列表不进索引：内容因人而异，且清单本身只存在访客浏览器里 */
type PageProps = { params: Promise<{ locale: string }> };

function resolve(locale: string): Locale {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = resolve(raw);
  const m = getMessages(locale);
  return buildMetadata({
    title: m.orders.metaTitle,
    description: m.orders.metaDescription,
    path: "/orders",
    locale,
    noindex: true,
  });
}

/**
 * 我的订单（0.4.2）
 *
 * 静态壳：订单凭据从 localStorage 读、状态从 /api/orders 取，页面本身不读
 * 请求期 API（不用 useSearchParams），因此 /[locale]/orders 仍参与预渲染。
 * 单个订单的明细仍在 /orders/[id]?token= 里，那里是 force-dynamic。
 */
export default async function OrdersPage({ params }: PageProps) {
  const { locale } = await params;
  return <OrdersView locale={resolve(locale)} />;
}

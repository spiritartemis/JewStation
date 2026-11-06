import type { Metadata } from "next";
import { CheckoutForm } from "@/components/cart/CheckoutForm";
import { buildMetadata } from "@/lib/seo";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

// 结账页同样不进索引：内容依赖访客自己的购物袋
type PageProps = { params: Promise<{ locale: string }> };

function resolve(locale: string): Locale {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = resolve(raw);
  const m = getMessages(locale);
  return buildMetadata({
    title: m.checkout.metaTitle,
    description: m.checkout.metaDescription,
    path: "/checkout",
    locale,
    noindex: true,
  });
}

/**
 * 结账（m-1c / 1c-1）
 *
 * 静态壳 + 客户端状态：袋子来自 localStorage，页面本身不需要动态渲染，
 * 这样 /checkout 仍能预渲染，首屏不依赖服务端。
 */
export default async function CheckoutPage({ params }: PageProps) {
  const { locale } = await params;
  return <CheckoutForm locale={resolve(locale)} />;
}

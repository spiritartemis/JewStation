import type { Metadata } from "next";
import { CartView } from "@/components/cart/CartView";
import { buildMetadata } from "@/lib/seo";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

// 购物袋不进索引：内容因人而异，收录一个空壳没有意义
type PageProps = { params: Promise<{ locale: string }> };

function resolve(locale: string): Locale {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = resolve(raw);
  const m = getMessages(locale);
  return buildMetadata({
    title: m.cart.metaTitle,
    description: m.cart.metaDescription,
    path: "/cart",
    locale,
    noindex: true,
  });
}

/**
 * 购物袋（m-1c / 1c-0）
 *
 * 页面本身是静态壳：袋子内容在客户端从 localStorage 读（见 CartProvider）。
 * 这样 /[locale]/cart 仍然参与预渲染，不会因为「用户相关数据」把整段路由拖成动态。
 */
export default async function CartPage({ params }: PageProps) {
  const { locale } = await params;
  return <CartView locale={resolve(locale)} />;
}

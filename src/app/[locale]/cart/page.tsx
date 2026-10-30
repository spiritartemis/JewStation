import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/PlaceholderPage";
import { buildMetadata } from "@/lib/seo";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

// 占位页不进索引：避免搜索引擎收录一个"购物袋为空"的空壳页
type PageProps = { params: Promise<{ locale: string }> };

function resolve(locale: string): Locale {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = resolve(raw);
  const m = getMessages(locale);
  return buildMetadata({
    title: m.nav.cart,
    description: m.cart.description,
    path: "/cart",
    locale,
    noindex: true,
  });
}

/** 购物袋属 m-1c；本线只保留路由与空态占位，避免导航 404。 */
export default async function CartPage({ params }: PageProps) {
  const { locale } = await params;
  const l = resolve(locale);
  const m = getMessages(l);

  return <PlaceholderPage title={m.cart.title} description={m.cart.description} locale={l} />;
}

import type { Metadata } from "next";
import { Hero } from "@/components/home/Hero";
import { JsonLdScript } from "@/components/JsonLd";
import { buildMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";import { getMessages } from "@/i18n/messages";
import { ProductRail } from "@/components/home/ProductRail";
import { StyleGrid } from "@/components/home/StyleGrid";
import { NewsletterSlot } from "@/components/home/NewsletterSlot";
import { getNewArrivals, getOneOfAKind, getTrending } from "@/lib/products";
import { organizationJsonLd, websiteJsonLd } from "@/lib/structured-data";

/**
 * 首页（B-2.2 区块顺序固定）：
 * Hero → 新品 → 手工孤品 → 流行款 → 风格入口 → 初访默认推荐位 → 安静的订阅入口
 *
 * ⚠️ 「You may like」初访默认取新品；个性化推荐属 m-1d，本线只留位。
 */
type PageProps = { params: Promise<{ locale: string }> };

async function resolveLocale(params: PageProps["params"]): Promise<Locale> {
  const { locale } = await params;
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await resolveLocale(params);
  return buildMetadata({
    title:
      locale === "zh"
        ? `${SITE.brandNameZh} ${SITE.brandName} — ${SITE.taglineZh}`
        : `${SITE.brandName} — ${SITE.tagline}`,
    description:
      locale === "zh"
        ? "小批量手作首饰，为正在成为的你。孤品只做一件，拍的就是你收到的那一件。"
        : "Small-batch handmade jewellery for the person you're becoming. One-of-a-kind pieces, photographed as the exact one you'll receive.",
    path: "/",
    locale,
    titleAbsolute: true,
  });
}

export default async function HomePage({ params }: PageProps) {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);

  const newArrivals = getNewArrivals(8);
  const oneOfAKind = getOneOfAKind(8);
  const trending = getTrending(8);

  return (
    <>
      {/* 站点级结构化数据：让搜索引擎拿到站点名与站内搜索入口 */}
      <JsonLdScript data={[websiteJsonLd(locale), organizationJsonLd()]} />

      <Hero locale={locale} />

      <ProductRail
        title={m.home.sections.newArrivals}
        products={newArrivals}
        locale={locale}
        href="/collections/new"
      />
      {/* 手工孤品 = 暖陶色，流行款 = 冷雾蓝：色相即品类信号（B-1.7）。
          孤品通常只有 1–2 件，用两列大卡填满容器，避免横滑条右侧留白 */}
      <ProductRail
        title={m.home.sections.oneOfAKind}
        products={oneOfAKind}
        locale={locale}
        href="/collections/one-of-a-kind"
        tone="clay"
        description={m.home.sections.oneOfAKindNote}
        layout="pair"
      />
      <ProductRail
        title={m.home.sections.trending}
        products={trending}
        locale={locale}
        href="/collections/restockable"
        tone="mist"
      />
      <StyleGrid locale={locale} />
      {/* 初访默认推荐位：无历史时回退新品（03 §7 兜底策略） */}
      <ProductRail
        title={m.home.sections.youMayLike}
        products={newArrivals.slice(0, 6)}
        locale={locale}
      />
      <NewsletterSlot locale={locale} />
    </>
  );
}

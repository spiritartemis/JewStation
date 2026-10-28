import { Hero } from "@/components/home/Hero";
import { buildMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";
import { ProductRail } from "@/components/home/ProductRail";
import { StyleGrid } from "@/components/home/StyleGrid";
import { NewsletterSlot } from "@/components/home/NewsletterSlot";
import { getNewArrivals, getOneOfAKind, getTrending } from "@/lib/products";

/**
 * 首页（B-2.2 区块顺序固定）：
 * Hero → 新品 → 手工孤品 → 流行款 → 风格入口 → 初访默认推荐位 → 安静的订阅入口
 *
 * ⚠️ 「You may like」初访默认取新品；个性化推荐属 m-1d，本线只留位。
 */
export const metadata = buildMetadata({
  title: `${SITE.brandName} — ${SITE.tagline}`,
  description: SITE.tagline,
  path: "/",
});

export default function HomePage() {
  const newArrivals = getNewArrivals(8);
  const oneOfAKind = getOneOfAKind(8);
  const trending = getTrending(8);

  return (
    <>
      <Hero />
      <ProductRail title="New arrivals" products={newArrivals} href="/collections/new" />
      <ProductRail
        title="One of a Kind"
        products={oneOfAKind}
        href="/collections/one-of-a-kind"
      />
      <ProductRail title="Trending" products={trending} href="/collections/restockable" />
      <StyleGrid />
      {/* 初访默认推荐位：无历史时回退新品（03 §7 兜底策略） */}
      <ProductRail title="You may like" products={newArrivals.slice(0, 6)} />
      <NewsletterSlot />
    </>
  );
}

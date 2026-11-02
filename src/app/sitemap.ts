import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";
import { getAllProducts, getProductsByCollection } from "@/lib/products";
import { CATEGORY_TAGS, STYLE_TAGS, MATERIAL_TAGS } from "@/lib/tags";
import { LOCALES, localePath } from "@/i18n/config";

/**
 * 站点地图（B-2.9：页面可被抓取）
 *
 * 双语（Q-02）：中英各出一条 <url>，并互相声明 hreflang。
 * 只发一条 URL 会让另一种语言的页面进不了索引；中文页 slug 与英文一致（Q-02），
 * 所以两种语言共用同一批 slug，不需要额外映射表。
 */
function entries(
  path: string,
  lastModified: Date,
  priority: number,
): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(
    LOCALES.map((locale) => [locale === "zh" ? "zh-CN" : "en", absoluteUrl(localePath(locale, path))]),
  );

  return LOCALES.map((locale) => ({
    url: absoluteUrl(localePath(locale, path)),
    lastModified,
    changeFrequency: "weekly" as const,
    priority,
    alternates: { languages },
  }));
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes = [
    "/",
    "/shop",
    "/about",
    "/faq",
    "/policies/privacy",
    "/policies/cookies",
    "/policies/returns",
    "/policies/shipping",
    "/policies/terms",
  ].flatMap((path) => entries(path, now, path === "/" ? 1 : 0.6));

  // 只收录**有商品**的集合页：标签字典里 8 个风格、16 种材质大部分暂时是空集合，
  // 把空页提交给搜索引擎等于主动制造「低质薄页」，对收录只有坏处。
  // 去重是为了防将来某个风格 slug 与品类 slug 撞名（03 §6.6 允许同源）。
  const collectionSlugs = Array.from(
    new Set([
      ...CATEGORY_TAGS.map((t) => t.slug),
      ...STYLE_TAGS.map((t) => t.slug),
      ...MATERIAL_TAGS.map((t) => t.slug),
      // 两个特殊集合原先漏了：新品与手工作品是首页直接链过去的落地页
      "new",
      "one-of-a-kind",
      "restockable",
    ]),
  ).filter((slug) => getProductsByCollection(slug).length > 0);

  const collections = collectionSlugs.flatMap((slug) =>
    entries(`/collections/${slug}`, now, 0.5),
  );

  const products = getAllProducts().flatMap((p) =>
    entries(`/products/${p.slug}`, new Date(p.updatedAt), 0.7),
  );

  return [...staticRoutes, ...collections, ...products];
}

import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";
import { getAllProducts } from "@/lib/products";
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

  const collectionSlugs = [
    ...CATEGORY_TAGS.map((t) => t.slug),
    ...STYLE_TAGS.map((t) => t.slug),
    ...MATERIAL_TAGS.map((t) => t.slug),
    // 两个特殊集合原先漏了：新品与手工作品是首页直接链过去的落地页
    "new",
    "one-of-a-kind",
    "restockable",
  ];

  const collections = collectionSlugs.flatMap((slug) =>
    entries(`/collections/${slug}`, now, 0.5),
  );

  const products = getAllProducts().flatMap((p) =>
    entries(`/products/${p.slug}`, new Date(p.updatedAt), 0.7),
  );

  return [...staticRoutes, ...collections, ...products];
}

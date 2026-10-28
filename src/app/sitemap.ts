import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";
import { getAllProducts } from "@/lib/products";
import { CATEGORY_TAGS, STYLE_TAGS, MATERIAL_TAGS } from "@/lib/tags";

/** 站点地图（B-2.9：页面可被抓取） */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes = ["", "/shop", "/about", "/faq", "/policies/privacy", "/policies/cookies", "/policies/returns", "/policies/shipping"].map(
    (path) => ({
      url: absoluteUrl(path),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: path === "" ? 1 : 0.6,
    }),
  );

  const collectionSlugs = [
    ...CATEGORY_TAGS.map((t) => t.slug),
    ...STYLE_TAGS.map((t) => t.slug),
    ...MATERIAL_TAGS.map((t) => t.slug),
    // 两个特殊集合原先漏了：新品与手工作品是首页直接链过去的落地页
    "new",
    "one-of-a-kind",
    "restockable",
  ];

  const collections = collectionSlugs.map((slug) => ({
    url: absoluteUrl(`/collections/${slug}`),
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));

  const products = getAllProducts().map((p) => ({
    url: absoluteUrl(`/products/${p.slug}`),
    lastModified: new Date(p.updatedAt),
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  return [...staticRoutes, ...collections, ...products];
}

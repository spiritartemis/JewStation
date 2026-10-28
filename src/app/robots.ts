import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

/** 搜索结果页不进索引（无实际内容价值，且会产生无限 URL 变体） */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/search", "/cart", "/checkout"] }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}

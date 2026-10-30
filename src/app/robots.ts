import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

/**
 * 搜索结果页与购物袋不进索引（无实际内容价值，且会产生无限 URL 变体）。
 * 中文站同一批路径也要挡：/zh/search、/zh/cart、/zh/checkout。
 */
export default function robots(): MetadataRoute.Robots {
  const disallow = [
    "/search",
    "/cart",
    "/checkout",
    "/zh/search",
    "/zh/cart",
    "/zh/checkout",
  ];

  return {
    rules: [{ userAgent: "*", allow: "/", disallow }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}

import { SITE } from "./site";
import { absoluteUrl, SITE_URL } from "./seo";

/**
 * 结构化数据（B-2.9 的延伸）
 *
 * 只描述页面上真实存在的信息，不堆关键词（m-1b bootstrap §5）。
 * 品牌名 / 邮箱 / 币种均为占位，待 Q-44 / Q-33 / Q-05 回填后自动生效。
 */

export type JsonLd = Record<string, unknown>;

/** 站点级：WebSite（供搜索引擎识别站点名与站内搜索入口） */
export function websiteJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.brandName,
    url: SITE_URL,
    inLanguage: SITE.locale,
    potentialAction: {
      "@type": "SearchAction",
      target: `${absoluteUrl("/search")}?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * 品牌级：Organization
 * 只填确定存在的信息；社交账号、地址、电话一律等站长提供后再加，不臆造。
 */
export function organizationJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.brandName,
    url: SITE_URL,
    email: SITE.supportEmail,
  };
}

/** 面包屑（详情页 / 集合页用） */
export function breadcrumbJsonLd(items: { name: string; path: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

import { SITE } from "./site";
import { absoluteUrl } from "./seo";
import { isSoldOut, localizeProduct, type Product } from "./types";
import { tagLabel } from "./tags";
import { DEFAULT_LOCALE, HTML_LANG, localePath, type Locale } from "@/i18n/config";

/**
 * 结构化数据（B-2.9 的延伸）
 *
 * 只描述页面上真实存在的信息，不堆关键词（m-1b bootstrap §5）。
 * 双语（Q-02）：名称与描述随当前语言走，inLanguage 与页面 <html lang> 一致；
 * 价格始终输出基准币种 USD —— 人民币是展示换算，不是可结算价。
 */

export type JsonLd = Record<string, unknown>;

/** 站点级：WebSite（供搜索引擎识别站点名与站内搜索入口） */
export function websiteJsonLd(locale: Locale = DEFAULT_LOCALE): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: locale === "zh" ? `${SITE.brandName} ${SITE.brandNameZh}` : SITE.brandName,
    url: absoluteUrl(localePath(locale, "/")),
    inLanguage: HTML_LANG[locale],
    potentialAction: {
      "@type": "SearchAction",
      target: `${absoluteUrl(localePath(locale, "/search"))}?q={search_term_string}`,
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
    url: absoluteUrl("/"),
    email: SITE.supportEmail,
  };
}

/** 面包屑（详情页 / 集合页用）；path 需传入已带语言前缀的对外路径 */
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

/**
 * 商品级：Product（B-2.9 的延伸）
 *
 * availability 由 stock 派生（02 §4.2），不手填；无图时不输出 image 字段，
 * 而不是塞一张占位图——避免把占位图当成商品图喂给搜索引擎。
 */
export function productJsonLd(p: Product, locale: Locale = DEFAULT_LOCALE): JsonLd {
  const localized = localizeProduct(p, locale);
  const images = p.images.map((i) => absoluteUrl(i.url));

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: localized.seoTitle ?? localized.title,
    description: localized.seoDescription ?? localized.shortCopy,
    sku: p.sku,
    category: tagLabel(p.category, locale),
    material: p.materials.join(", "),
    ...(images.length ? { image: images } : {}),
    brand: { "@type": "Brand", name: SITE.brandName },
    offers: {
      "@type": "Offer",
      url: absoluteUrl(localePath(locale, `/products/${p.slug}`)),
      price: p.price,
      priceCurrency: p.currency,
      availability: isSoldOut(p)
        ? "https://schema.org/SoldOut"
        : "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
    },
  };
}

/**
 * FAQ 级：FAQPage（B-2.9 的延伸）
 *
 * 只把**已确定的答案**提交给搜索引擎：带待确认标记的条目在确认前不进结构化数据，
 * 否则等于把尚未定稿的口径当作正式答案发布出去。
 */
export function faqJsonLd(
  items: { question: string; answer: string; pending?: string }[],
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items
      .filter((i) => !i.pending)
      .map((i) => ({
        "@type": "Question",
        name: i.question,
        acceptedAnswer: { "@type": "Answer", text: i.answer },
      })),
  };
}

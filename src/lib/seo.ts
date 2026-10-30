import type { Metadata } from "next";
import { SITE } from "./site";
import { DEFAULT_LOCALE, OG_LOCALE, localePath, type Locale } from "@/i18n/config";

/**
 * SEO 工具（B-2.9 + Q-02 双语）
 *
 * 站点域名待定（Q-39）：先用环境变量 NEXT_PUBLIC_SITE_URL，缺省回退 localhost，
 * 域名确定后只需配置环境变量，无需改代码。
 *
 * 双语要点：
 *  - canonical 指向**该语言自己的**对外 URL（英文无前缀、中文 /zh），
 *    否则中文页会被当成英文页的重复内容。
 *  - 每页都给全 en / zh-CN / x-default 三条 hreflang，缺一条 Google 就可能选错版本。
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

export function absoluteUrl(path: string): string {
  return new URL(path.startsWith("/") ? path : `/${path}`, SITE_URL).toString();
}

/** 语言无关路径 → 该语言的对外 URL（英文即原路径，中文加 /zh） */
export function canonicalFor(locale: Locale, path: string): string {
  return absoluteUrl(localePath(locale, path));
}

export function buildMetadata({
  title,
  description,
  path,
  locale = DEFAULT_LOCALE,
  noindex = false,
  image,
  titleAbsolute = false,
}: {
  title: string;
  description: string;
  /** 语言无关路径，如 /shop */
  path: string;
  locale?: Locale;
  noindex?: boolean;
  /** 分享图；品牌素材到位后传绝对路径。为空时不输出 og:image，不拿占位图顶替 */
  image?: string;
  /** 首页等已经带品牌名的标题：不再套 "%s | Brand" 模板，避免出现两遍品牌名 */
  titleAbsolute?: boolean;
}): Metadata {
  const imageUrl = image ? absoluteUrl(image) : undefined;
  const canonical = canonicalFor(locale, path);

  return {
    title: titleAbsolute ? { absolute: title } : title,
    description,
    alternates: {
      canonical,
      languages: {
        en: absoluteUrl(path),
        "zh-CN": absoluteUrl(localePath("zh", path)),
        "x-default": absoluteUrl(path),
      },
    },
    openGraph: {
      title: `${title} | ${SITE.brandName}`,
      description,
      url: canonical,
      siteName: SITE.brandName,
      locale: OG_LOCALE[locale],
      type: "website",
      ...(imageUrl ? { images: [{ url: imageUrl }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(imageUrl ? { images: [imageUrl] } : {}),
    },
    robots: noindex ? { index: false, follow: true } : undefined,
  };
}

import type { Metadata } from "next";
import { SITE } from "./site";

/**
 * SEO 工具（B-2.9）
 * 站点域名待定（Q-39）：先用环境变量 NEXT_PUBLIC_SITE_URL，缺省回退 localhost，
 * 域名确定后只需配置环境变量，无需改代码。
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

export function absoluteUrl(path: string): string {
  return new URL(path.startsWith("/") ? path : `/${path}`, SITE_URL).toString();
}

export function buildMetadata({
  title,
  description,
  path,
  noindex = false,
}: {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path) },
    openGraph: {
      title: `${title} | ${SITE.brandName}`,
      description,
      url: absoluteUrl(path),
      siteName: SITE.brandName,
      locale: SITE.locale,
      type: "website",
    },
    twitter: { card: "summary_large_image", title, description },
    robots: noindex ? { index: false, follow: true } : undefined,
  };
}

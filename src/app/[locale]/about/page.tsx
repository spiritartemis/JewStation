import type { Metadata } from "next";
import { DocView } from "@/components/content/DocView";
import { getContent } from "@/i18n/content";
import { buildMetadata } from "@/lib/seo";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";

type PageProps = { params: Promise<{ locale: string }> };

function resolve(locale: string): Locale {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = resolve(raw);
  return buildMetadata({
    title: locale === "zh" ? "关于我们" : "About",
    description:
      locale === "zh"
        ? "小批量首饰：手作孤品与限量批次，从中国义乌发出，售价含税。"
        : "Small-batch jewellery: hand-formed one-of-a-kind pieces and limited runs, shipped from Yiwu, China. Prices include tax.",
    path: "/about",
    locale,
  });
}

export default async function AboutPage({ params }: PageProps) {
  const { locale } = await params;

  return <DocView doc={getContent(resolve(locale)).about} locale={resolve(locale)} />;
}

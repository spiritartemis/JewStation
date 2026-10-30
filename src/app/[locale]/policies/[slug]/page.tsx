import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocView } from "@/components/content/DocView";
import { getContent } from "@/i18n/content";
import { buildMetadata } from "@/lib/seo";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";

/**
 * 政策页：固定路径、文案来自内容源，未审核前明确标注（01 §4 / B-2.8）
 * 双语（Q-02）：slug 中英一致（中文页也用英文词），正文取对应语言版本
 */
type PageProps = { params: Promise<{ locale: string; slug: string }> };

function resolve(locale: string): Locale {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

export default async function PolicyPage({ params }: PageProps) {
  const { locale: raw, slug } = await params;
  const locale = resolve(raw);
  const doc = getContent(locale).policies.find((p) => p.slug === slug);
  if (!doc) notFound();

  return <DocView doc={doc} locale={locale} />;
}

/** 描述取正文首段，保证每页 description 描述的是这页的真实内容（不是关键词堆） */
function descriptionOf(blocks: readonly { type: string; text?: string }[]): string {
  const first = blocks.find((b) => b.type === "p" && b.text);
  return first?.text ? first.text.slice(0, 140) : "";
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = resolve(raw);
  const doc = getContent(locale).policies.find((p) => p.slug === slug);
  if (!doc) return { title: locale === "zh" ? "页面不存在" : "Policy not found" };

  // 政策页同样需要规范 URL 与分享预览（B-2.9）
  return buildMetadata({
    title: doc.title,
    description: descriptionOf(doc.blocks) || doc.title,
    path: `/policies/${doc.slug}`,
    locale,
  });
}

export function generateStaticParams() {
  // slug 中英相同（Q-02：中文页 slug 用英文词），因此只需一份
  return getContent(DEFAULT_LOCALE).policies.map((p) => ({ slug: p.slug }));
}

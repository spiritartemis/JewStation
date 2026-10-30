import type { Metadata } from "next";
import { JsonLdScript } from "@/components/JsonLd";
import { buildMetadata } from "@/lib/seo";
import { faqJsonLd } from "@/lib/structured-data";
import { getContent } from "@/i18n/content";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/** FAQ（内容源自 src/i18n/content.ts，不硬编码在页面里） */
type PageProps = { params: Promise<{ locale: string }> };

function resolve(locale: string): Locale {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = resolve(raw);
  return buildMetadata({
    title: locale === "zh" ? "常见问题" : "FAQ",
    description:
      locale === "zh"
        ? "配送、退换、保养、材质与订单问题。"
        : "Shipping, returns, care, materials and order questions.",
    path: "/faq",
    locale,
  });
}

export default async function FaqPage({ params }: PageProps) {
  const { locale: raw } = await params;
  const locale = resolve(raw);
  const m = getMessages(locale);
  const items = getContent(locale).faq;
  const pendingCount = items.filter((i) => i.pending).length;

  return (
    <div className="shell max-w-[68ch] py-sp6">
      {/* 只提交已确定的答案；带待确认标记的条目不进结构化数据 */}
      <JsonLdScript data={faqJsonLd(items)} />

      <h1 className="font-serif text-h1 text-ink">{locale === "zh" ? "常见问题" : "FAQ"}</h1>

      <div className="mt-sp5 divide-y divide-line border-y border-line">
        {items.map((item) => (
          <details key={item.id} id={item.id} className="group">
            <summary className="flex min-h-[44px] cursor-pointer items-center justify-between gap-sp4 text-body text-ink">
              <span>{item.question}</span>
              <span className="text-muted" aria-hidden="true">
                +
              </span>
            </summary>
            <p className="pb-sp2 text-body text-muted">{item.answer}</p>
            {/* 待确认项在页面上就地标出，避免读者把未定口径当最终答案 */}
            {item.pending ? (
              <p className="mb-sp4 rounded-btn border border-warn/40 bg-warn/5 px-sp3 py-sp2 text-aux text-warn">
                {m.common.pending} — {item.pending}
              </p>
            ) : null}
          </details>
        ))}
      </div>

      {pendingCount > 0 ? (
        <p className="mt-sp6 text-aux text-muted">
          {locale === "zh"
            ? `其中 ${pendingCount} 条标注「${m.common.pending}」，上线前必须定稿。`
            : `${pendingCount} answer${pendingCount === 1 ? "" : "s"} marked “${m.common.pending}” must be settled before launch.`}
        </p>
      ) : null}
    </div>
  );
}

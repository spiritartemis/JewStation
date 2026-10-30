import type { Metadata } from "next";
import Link from "next/link";
import { ProductGrid } from "@/components/product/ProductGrid";
import { searchProducts } from "@/lib/products";
import { buildMetadata } from "@/lib/seo";
import { CATEGORY_TAGS, MATERIAL_TAGS, STYLE_TAGS, tagLabel } from "@/lib/tags";
import { DEFAULT_LOCALE, isLocale, localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/**
 * 搜索结果页（B-2.5）
 * - 命中商品标题与标签（多词按 AND 匹配，见 lib/products.ts）
 * - 三个状态齐备：空查询（未输入）· 无结果 · 有结果
 * - 「清空搜索」在**有结果时同样可用**（否则用户只能手动删掉输入框）
 * - 状态为空时给可点的建议词，避免死路
 *
 * 双语（Q-02）：建议词取当前语言的标签名，但搜索仍需能命中英文标题 ——
 * 所以建议词同时带上标签 slug，搜索时 slug 与展示名都参与匹配。
 */
type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
};

const SUGGESTION_TAGS = [
  ...CATEGORY_TAGS.slice(0, 3),
  ...STYLE_TAGS.slice(0, 2),
  ...MATERIAL_TAGS.slice(0, 3),
];

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const m = getMessages(locale);
  return buildMetadata({
    title: m.search.title,
    description:
      locale === "zh" ? "按商品名、材质或风格搜索。" : "Search by product name, material or style.",
    path: "/search",
    locale,
    noindex: true,
  });
}

function SuggestionChips({ locale }: { locale: Locale }) {
  const m = getMessages(locale);
  return (
    <div className="mt-sp4">
      <p className="text-aux uppercase tracking-[0.16em] text-muted">{m.search.tryLabel}</p>
      <div className="mt-sp2 flex flex-wrap justify-center gap-sp2">
        {SUGGESTION_TAGS.map((t) => (
          <Link
            key={t.slug}
            href={`${localePath(locale, "/search")}?q=${encodeURIComponent(t.label)}`}
            className="inline-flex h-9 items-center rounded-btn border border-line bg-surface px-sp3 text-aux text-ink hover:border-accent"
          >
            {tagLabel(t.slug, locale)}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default async function SearchPage({ params, searchParams }: PageProps) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const m = getMessages(locale);
  const searchHref = localePath(locale, "/search");

  const sp = await searchParams;
  const rawQuery = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const query = (rawQuery ?? "").trim();
  const results = query ? searchProducts(query) : [];

  return (
    <div className="shell py-sp5 pb-sp6">
      {/* 原生 GET 表单：无 JS 也可用；action 带语言前缀，否则中文页搜一次就掉回英文页 */}
      <form action={searchHref} method="get" className="flex items-center gap-sp2">
        <label htmlFor="q" className="sr-only">
          {m.search.labelAria}
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder={m.search.placeholder}
          className="h-12 flex-1 rounded-btn border border-line bg-surface px-sp3 text-body text-ink"
        />
        <button type="submit" className="h-12 rounded-btn bg-accent px-sp5 text-body text-onAccent">
          {m.search.submit}
        </button>
      </form>

      <div className="mt-sp5">
        {!query ? (
          <div className="py-sp6 text-center">
            <h1 className="font-serif text-h1 text-ink">{m.search.title}</h1>
            <p className="mt-sp3 text-body text-muted">{m.search.hint}</p>
            <SuggestionChips locale={locale} />
          </div>
        ) : results.length > 0 ? (
          <>
            <div className="mb-sp4 flex flex-wrap items-baseline justify-between gap-sp2">
              <p className="text-aux text-muted">{m.search.resultsFor(results.length, query)}</p>
              <Link href={searchHref} className="text-aux text-muted underline hover:text-accent">
                {m.search.clearSearch}
              </Link>
            </div>
            <ProductGrid products={results} locale={locale} />
          </>
        ) : (
          <div className="py-sp6 text-center">
            <h1 className="font-serif text-h1 text-ink">{m.search.noResults}</h1>
            <p className="mt-sp3 text-body text-muted">{m.search.noResultsHint(query)}</p>
            <SuggestionChips locale={locale} />
            <div className="mt-sp5 flex flex-wrap justify-center gap-sp3">
              <Link
                href={searchHref}
                className="inline-flex h-12 items-center justify-center rounded-btn border border-line px-sp5 text-body text-ink"
              >
                {m.search.clearSearch}
              </Link>
              <Link
                href={localePath(locale, "/shop")}
                className="inline-flex h-12 items-center justify-center rounded-btn bg-accent px-sp5 text-body text-onAccent"
              >
                {m.search.browseAll}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

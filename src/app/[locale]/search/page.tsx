import type { Metadata } from "next";
import Link from "next/link";
import { ProductGrid } from "@/components/product/ProductGrid";
import { SearchCategoryFilters } from "@/components/product/SearchCategoryFilters";
import { getAllProducts, getFilteredProducts, searchProducts } from "@/lib/products";
import { parseListParams, toProductFilters, splitList } from "@/lib/filters";
import { buildMetadata } from "@/lib/seo";
import { CATEGORY_TAGS, MATERIAL_TAGS, STYLE_TAGS, tagLabel } from "@/lib/tags";
import { DEFAULT_LOCALE, isLocale, localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/**
 * 搜索结果页（B-2.5）
 * - 命中商品标题与标签（多词按 AND 匹配，见 lib/products.ts）
 * - 三个状态齐备：空查询 · 无结果 · 有结果
 * - 「清空条件」在有结果时同样可用（否则用户只能手动删掉输入框/取消勾选）
 *
 * 0.4.10：站长把列表页左侧的分类勾选搬到了这里。
 * 品类沿用列表页的 URL 口径 `category=a,b`，与搜索词 q 取交集，可分享可回退；
 * 原生 GET 表单里带隐藏 category / sharecode 字段，改搜索词时不会把已选品类丢掉。
 *
 * 双语（Q-02）：建议词取当前语言的标签名，但搜索仍需能命中英文标题。
 */
type PageProps = {
  params: Promise<{ locale: string }>;
  /** 0.4.9：原生 GET 表单提交会丢掉地址栏里的 sharecode，网关会直接拦成 403。
   *  把当前分享码作为隐藏字段随表单一起提交，保证无 JS 时也能正常搜索。
   *  0.4.10：品类参数也一并保留。 */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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
            // 建议词的**显示文字**与**实际查询词**必须是同一个：中文页显示「耳环」却去搜
            // "Earrings"，用户看不出发生了什么，分享出去的地址也和页面文字对不上。
            href={`${localePath(locale, "/search")}?q=${encodeURIComponent(tagLabel(t.slug, locale))}`}
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
  const listParams = parseListParams(sp);
  const rawQuery = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const query = (rawQuery ?? "").trim();
  const rawCode = Array.isArray(sp.sharecode) ? sp.sharecode[0] : sp.sharecode;
  const sharecode = typeof rawCode === "string" ? rawCode : "";

  const categories = splitList(listParams.category);
  const hasQuery = query.length > 0;
  const hasCategory = categories.length > 0;
  // 只勾品类、没输关键词时也要出结果，否则勾选框看起来像坏了
  const showResults = hasQuery || hasCategory;
  const base = hasQuery ? searchProducts(query) : getAllProducts();
  const results = showResults ? getFilteredProducts(toProductFilters(listParams), base) : [];

  return (
    <div className="shell py-sp5 pb-sp6">
      {/* 原生 GET 表单：无 JS 也可用；action 带语言前缀，否则中文页搜一次就掉回英文页 */}
      <form action={searchHref} method="get" className="flex items-center gap-sp2">
        {sharecode ? <input type="hidden" name="sharecode" value={sharecode} /> : null}
        {categories.length ? (
          <input type="hidden" name="category" value={categories.join(",")} />
        ) : null}
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

      {/* 0.4.10：从列表页左侧搬过来的分类勾选，始终可见 */}
      <SearchCategoryFilters params={listParams} basePath={searchHref} locale={locale} />

      <div className="mt-sp5">
        {!showResults ? (
          <div className="py-sp6 text-center">
            <h1 className="font-serif text-h1 text-ink">{m.search.title}</h1>
            <p className="mt-sp3 text-body text-muted">{m.search.hint}</p>
            <SuggestionChips locale={locale} />
          </div>
        ) : results.length > 0 ? (
          <>
            <div className="mb-sp4 flex flex-wrap items-baseline justify-between gap-sp2">
              {/* 有结果时页面原先没有 h1（只有一句统计文案），读屏与 SEO 都缺页面主题 */}
              {/* 只勾品类、没输关键词时不要再写一遍「搜索结果 / Search results」，
                  否则会读成「搜索结果共 3 件结果」 */}
              <h1 className="text-body text-ink">
                {hasQuery ? (
                  <>
                    {locale === "zh" ? "搜索结果" : "Search results"}
                    <span className="ml-sp2 text-aux text-muted">
                      {m.search.resultsFor(results.length, query)}
                    </span>
                  </>
                ) : (
                  m.search.resultsCount(results.length)
                )}
              </h1>
              <Link href={searchHref} className="text-aux text-muted underline hover:text-accent">
                {m.search.clearAll}
              </Link>
            </div>
            <ProductGrid products={results} locale={locale} />
          </>
        ) : (
          <div className="py-sp6 text-center">
            <h1 className="font-serif text-h1 text-ink">{m.search.noResults}</h1>
            <p className="mt-sp3 text-body text-muted">
              {hasQuery ? m.search.noResultsHint(query) : m.search.noResultsHintCategories}
            </p>
            <SuggestionChips locale={locale} />
            <div className="mt-sp5 flex flex-wrap justify-center gap-sp3">
              <Link
                href={searchHref}
                className="inline-flex h-12 items-center justify-center rounded-btn border border-line px-sp5 text-body text-ink"
              >
                {m.search.clearAll}
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

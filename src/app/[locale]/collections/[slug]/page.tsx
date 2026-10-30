import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FilterControls } from "@/components/product/FilterControls";
import { ActiveFilters } from "@/components/product/ActiveFilters";
import { SortSelect } from "@/components/product/SortSelect";
import { ProductGrid, ProductGridEmpty } from "@/components/product/ProductGrid";
import {
  parseListParams,
  toProductFilters,
  countActiveFilters,
  type ListParams,
} from "@/lib/filters";
import { getFilteredProducts, getProductsByCollection } from "@/lib/products";
import { tagLabel, isKnownCollection } from "@/lib/tags";
import { JsonLdScript } from "@/components/JsonLd";
import { buildMetadata } from "@/lib/seo";
import { breadcrumbJsonLd } from "@/lib/structured-data";
import { DEFAULT_LOCALE, isLocale, localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/** 集合页 slug = 标签 slug（03 §6.6），与列表页共用网格与筛选口径 */
const SPECIAL = new Set(["new", "one-of-a-kind", "one_of_a_kind", "restockable"]);

function titleOf(slug: string, locale: Locale): string {
  const m = getMessages(locale);
  if (slug === "new") return m.nav.newArrivals;
  if (slug === "restockable") return m.nav.restockable;
  if (slug === "one-of-a-kind" || slug === "one_of_a_kind") return m.nav.oneOfAKind;
  return tagLabel(slug, locale);
}

type PageProps = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CollectionPage({ params, searchParams }: PageProps) {
  const { locale: raw, slug } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  if (!SPECIAL.has(slug) && !isKnownCollection(slug)) notFound();

  const m = getMessages(locale);
  const sp = await searchParams;
  const listParams: ListParams = parseListParams(sp);
  const filters = toProductFilters(listParams);
  const basePath = localePath(locale, `/collections/${slug}`);

  // 先取集合，再在集合内应用筛选（B-2.3 可叠加）
  const products = getFilteredProducts(filters, getProductsByCollection(slug));
  const activeCount = countActiveFilters(listParams);
  const title = titleOf(slug, locale);

  return (
    <div className="pb-sp6">
      {/* 集合页层级：Home / Shop / 集合名 */}
      <JsonLdScript
        data={breadcrumbJsonLd([
          { name: m.common.home, path: localePath(locale, "/") },
          { name: m.nav.shop, path: localePath(locale, "/shop") },
          { name: title, path: basePath },
        ])}
      />

      <div className="shell pt-sp5">
        <div className="flex items-end justify-between gap-sp4">
          <div>
            <h1 className="font-serif text-h1 text-ink">{title}</h1>
            <p className="mt-sp2 text-aux text-muted">{m.list.countOnly(products.length)}</p>
          </div>
          <div className="hidden shrink-0 lg:block">
            <SortSelect params={listParams} basePath={basePath} locale={locale} />
          </div>
        </div>
      </div>

      <ActiveFilters params={listParams} basePath={basePath} locale={locale} />

      <div className="lg:mt-sp5 lg:flex lg:gap-sp6 lg:px-sp4">
        <FilterControls
          params={listParams}
          resultCount={products.length}
          basePath={basePath}
          locale={locale}
        />

        <div className="min-w-0 flex-1">
          {products.length > 0 ? (
            <ProductGrid products={products} locale={locale} />
          ) : (
            <ProductGridEmpty
              locale={locale}
              onClear={
                activeCount > 0 ? (
                  <Link
                    href={basePath}
                    className="inline-flex h-12 items-center justify-center rounded-btn border border-line px-sp5 text-body text-ink"
                  >
                    {m.list.clearFilters}
                  </Link>
                ) : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const name = titleOf(slug, locale);

  return buildMetadata({
    title: name,
    description:
      locale === "zh"
        ? `${name}——按品类、风格、材质、价格与类型筛选。`
        : `${name} — browse ${name.toLowerCase()} jewellery. Filter by category, style, material, price and type.`,
    path: `/collections/${slug}`,
    locale,
  });
}

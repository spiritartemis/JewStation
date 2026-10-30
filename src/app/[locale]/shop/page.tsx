import type { Metadata } from "next";
import Link from "next/link";
import { FilterControls } from "@/components/product/FilterControls";
import { ActiveFilters } from "@/components/product/ActiveFilters";
import { SortSelect } from "@/components/product/SortSelect";
import { ProductGrid, ProductGridEmpty } from "@/components/product/ProductGrid";
import { parseListParams, toProductFilters, countActiveFilters } from "@/lib/filters";
import { getAllProducts, getFilteredProducts } from "@/lib/products";
import { buildMetadata } from "@/lib/seo";
import { DEFAULT_LOCALE, isLocale, localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/**
 * 商品列表（全部商品）
 * B-2.3 筛选可组合且每个值可直达 URL；B-2.4 卡片信息完整；01 §5 空态必备。
 *
 * 注意 basePath 要给**带语言前缀**的路径：筛选是把 URL 整体 replace，
 * 传 /shop 的话中文页一改筛选就掉回英文页。
 */
type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolveLocale(params: PageProps["params"]): Promise<Locale> {
  const { locale } = await params;
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  return buildMetadata({
    title: m.list.allProducts,
    description:
      locale === "zh"
        ? "浏览全部款式——按品类、风格、材质、价格与类型筛选。"
        : "Browse every piece — filter by category, style, material, price and type.",
    path: "/shop",
    locale,
  });
}

export default async function ShopPage({ params, searchParams }: PageProps) {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  const basePath = localePath(locale, "/shop");

  const sp = await searchParams;
  const listParams = parseListParams(sp);
  const filters = toProductFilters(listParams);
  const products = getFilteredProducts(filters);
  const total = getAllProducts().length;
  const activeCount = countActiveFilters(listParams);

  return (
    <div className="pb-sp6">
      <div className="shell pt-sp5">
        <div className="flex items-end justify-between gap-sp4">
          <div>
            <h1 className="font-serif text-h1 text-ink">{m.list.allProducts}</h1>
            <p className="mt-sp2 text-aux text-muted">{m.list.countOf(products.length, total)}</p>
          </div>
          {/* 桌面端排序：移动端的排序在吸顶筛选条里（SortSelect 同一实现） */}
          <div className="hidden shrink-0 lg:block">
            <SortSelect params={listParams} basePath={basePath} locale={locale} />
          </div>
        </div>
      </div>

      {/* 已选筛选显性化：可单独移除，不必重开抽屉 */}
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

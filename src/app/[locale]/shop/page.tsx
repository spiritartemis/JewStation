import type { Metadata } from "next";
import Link from "next/link";
import { FilterControls } from "@/components/product/FilterControls";
import { ActiveFilters } from "@/components/product/ActiveFilters";
import { SortSelect } from "@/components/product/SortSelect";
import { ListSearch } from "@/components/product/ListSearch";
import { ProductGrid, ProductGridEmpty } from "@/components/product/ProductGrid";
import { parseListParams, toProductFilters, countActiveFilters } from "@/lib/filters";
import { getAllProducts, getFilteredProducts, searchProducts } from "@/lib/products";
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
  // 列表内搜索与筛选叠加：先按词收窄，再套筛选条件（两者都可直达 URL）
  const keyword = listParams.q?.trim() ?? "";
  const products = getFilteredProducts(filters, keyword ? searchProducts(keyword) : undefined);
  const total = getAllProducts().length;
  const activeCount = countActiveFilters(listParams);
  /** 有关键词也算「已收窄」：计数要写成「10 件中 3 件」，空态也要给出清除入口 */
  const narrowed = activeCount > 0 || keyword.length > 0;

  return (
    <div className="pb-sp6">
      <div className="shell pt-sp5">
        <div className="flex items-end justify-between gap-sp4">
          <div>
            <h1 className="font-serif text-h1 text-ink">{m.list.allProducts}</h1>
            {/* 无筛选时不再写"共 10 件，当前显示 10 件"：同一句话里重复两遍数字 */}
            <p className="mt-sp2 text-aux text-muted">
              {narrowed ? m.list.countOf(products.length, total) : m.list.countOnly(total)}
            </p>
          </div>
          {/* 桌面端：列表内搜索 + 排序（移动端的排序在吸顶筛选条里，搜索走顶栏入口） */}
          <div className="hidden shrink-0 items-center gap-sp3 lg:flex">
            <ListSearch
              params={listParams}
              basePath={basePath}
              locale={locale}
              className="w-[248px]"
            />
            <SortSelect params={listParams} basePath={basePath} locale={locale} />
          </div>
        </div>
      </div>

      {/* 已选筛选显性化：可单独移除，不必重开抽屉 */}
      <ActiveFilters params={listParams} basePath={basePath} locale={locale} />

      {/* 两栏容器回到 .shell：标题在 1200px 栏里，网格也必须对齐，
          否则宽屏下筛选栏贴边、网格铺满全屏，和标题各说各的 */}
      <div className="shell lg:mt-sp5 lg:flex lg:gap-sp6">
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
              message={keyword ? m.list.noMatchQuery(keyword) : undefined}
              onClear={
                narrowed ? (
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

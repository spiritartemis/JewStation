import Link from "next/link";
import { FilterControls } from "@/components/product/FilterControls";
import { ActiveFilters } from "@/components/product/ActiveFilters";
import { SortSelect } from "@/components/product/SortSelect";
import { ProductGrid, ProductGridEmpty } from "@/components/product/ProductGrid";
import { parseListParams, toProductFilters, countActiveFilters } from "@/lib/filters";
import { getAllProducts, getFilteredProducts } from "@/lib/products";
import { buildMetadata } from "@/lib/seo";

/**
 * 商品列表（全部商品）
 * B-2.3 筛选可组合且每个值可直达 URL；B-2.4 卡片信息完整；01 §5 空态必备。
 */
export const metadata = buildMetadata({
  title: "All products",
  description: "Browse every piece — filter by category, style, material, price and type.",
  path: "/shop",
});

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = parseListParams(sp);
  const filters = toProductFilters(params);
  const products = getFilteredProducts(filters);
  const total = getAllProducts().length;
  const activeCount = countActiveFilters(params);

  return (
    <div className="pb-sp6">
      <div className="shell pt-sp5">
        <div className="flex items-end justify-between gap-sp4">
          <div>
            <h1 className="font-serif text-h1 text-ink">All products</h1>
            <p className="mt-sp2 text-aux text-muted">
              {products.length} of {total} products
            </p>
          </div>
          {/* 桌面端排序：移动端的排序在吸顶筛选条里（SortSelect 同一实现） */}
          <div className="hidden shrink-0 md:block">
            <SortSelect params={params} basePath="/shop" />
          </div>
        </div>
      </div>

      {/* 已选筛选显性化：可单独移除，不必重开抽屉 */}
      <ActiveFilters params={params} basePath="/shop" />

      <div className="md:mt-sp5 md:flex md:gap-sp6 md:px-sp4">
        <FilterControls params={params} resultCount={products.length} basePath="/shop" />

        <div className="min-w-0 flex-1">
          {products.length > 0 ? (
            <ProductGrid products={products} />
          ) : (
            <ProductGridEmpty
              onClear={
                activeCount > 0 ? (
                  <Link
                    href="/shop"
                    className="inline-flex h-12 items-center justify-center rounded-btn border border-line px-sp5 text-body text-ink"
                  >
                    Clear filters
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

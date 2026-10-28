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

/** 集合页 slug = 标签 slug（03 §6.6），与列表页共用网格与筛选口径 */
const SPECIAL = new Set(["new", "one-of-a-kind", "one_of_a_kind", "restockable"]);

function titleOf(slug: string): string {
  if (slug === "new") return "New arrivals";
  if (slug === "restockable") return "Restockable";
  if (slug === "one-of-a-kind" || slug === "one_of_a_kind") return "One of a Kind";
  return tagLabel(slug);
}

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  if (!SPECIAL.has(slug) && !isKnownCollection(slug)) notFound();

  const sp = await searchParams;
  const listParams: ListParams = parseListParams(sp);
  const filters = toProductFilters(listParams);
  const basePath = `/collections/${slug}`;

  // 先取集合，再在集合内应用筛选（B-2.3 可叠加）
  const products = getFilteredProducts(filters, getProductsByCollection(slug));
  const activeCount = countActiveFilters(listParams);

  return (
    <div className="pb-sp6">
      {/* 集合页层级：Home / Shop / 集合名 */}
      <JsonLdScript
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Shop", path: "/shop" },
          { name: titleOf(slug), path: basePath },
        ])}
      />

      <div className="shell pt-sp5">
        <div className="flex items-end justify-between gap-sp4">
          <div>
            <h1 className="font-serif text-h1 text-ink">{titleOf(slug)}</h1>
            <p className="mt-sp2 text-aux text-muted">{products.length} products</p>
          </div>
          <div className="hidden shrink-0 md:block">
            <SortSelect params={listParams} basePath={basePath} />
          </div>
        </div>
      </div>

      <ActiveFilters params={listParams} basePath={basePath} />

      <div className="md:mt-sp5 md:flex md:gap-sp6 md:px-sp4">
        <FilterControls
          params={listParams}
          resultCount={products.length}
          basePath={basePath}
        />

        <div className="min-w-0 flex-1">
          {products.length > 0 ? (
            <ProductGrid products={products} />
          ) : (
            <ProductGridEmpty
              onClear={
                activeCount > 0 ? (
                  <Link
                    href={basePath}
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

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const name = titleOf(slug);

  // 原先只返回 title，集合页没有 canonical 与 OG——B-2.9 要求每页规范 URL 与分享预览
  return buildMetadata({
    title: name,
    description: `${name} — browse ${name.toLowerCase()} jewellery. Filter by category, style, material, price and type.`,
    path: `/collections/${slug}`,
  });
}

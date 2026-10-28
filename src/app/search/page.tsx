import Link from "next/link";
import { ProductGrid } from "@/components/product/ProductGrid";
import { searchProducts } from "@/lib/products";
import { buildMetadata } from "@/lib/seo";

/**
 * 搜索结果页（B-2.5）
 * - 命中商品英文标题与标签
 * - 三个状态齐备：空查询（未输入）· 无结果 · 有结果
 * - 「清空搜索」回到 /search
 */
export const metadata = buildMetadata({
  title: "Search",
  description: "Search by product name, material or style.",
  path: "/search",
  noindex: true,
});

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const query = (raw ?? "").trim();
  const results = query ? searchProducts(query) : [];

  return (
    <div className="shell py-sp5 pb-sp6">
      {/* 原生 GET 表单：无 JS 也可用 */}
      <form action="/search" method="get" className="flex items-center gap-sp2">
        <label htmlFor="q" className="sr-only">
          Search products
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Search earrings, silver, pearl…"
          className="h-12 flex-1 rounded-btn border border-line bg-surface px-sp3 text-body text-ink"
        />
        <button
          type="submit"
          className="h-12 rounded-btn bg-accent px-sp5 text-body text-white"
        >
          Search
        </button>
      </form>

      <div className="mt-sp5">
        {!query ? (
          <div className="py-sp6 text-center">
            <h1 className="font-serif text-h1 text-ink">Search</h1>
            <p className="mt-sp3 text-body text-muted">
              Try a product name, material or style — for example “hoops”, “silver” or “minimal”.
            </p>
          </div>
        ) : results.length > 0 ? (
          <>
            <p className="mb-sp4 text-aux text-muted">
              {results.length} result{results.length === 1 ? "" : "s"} for “{query}”
            </p>
            <ProductGrid products={results} />
          </>
        ) : (
          <div className="py-sp6 text-center">
            <h1 className="font-serif text-h1 text-ink">No results</h1>
            <p className="mt-sp3 text-body text-muted">
              Nothing matches “{query}”. Try a shorter word, or browse all products.
            </p>
            <div className="mt-sp5 flex flex-wrap justify-center gap-sp3">
              <Link
                href="/search"
                className="inline-flex h-12 items-center justify-center rounded-btn border border-line px-sp5 text-body text-ink"
              >
                Clear search
              </Link>
              <Link
                href="/shop"
                className="inline-flex h-12 items-center justify-center rounded-btn bg-accent px-sp5 text-body text-white"
              >
                Browse all products
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

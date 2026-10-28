import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductGallery } from "@/components/product/ProductGallery";
import { ProductCard } from "@/components/product/ProductCard";
import { getProductBySlug, getProductsByCollection } from "@/lib/products";
import { formatPrice, isSoldOut, lowStockLabel, soldLabel } from "@/lib/types";
import { tagLabel } from "@/lib/tags";

/**
 * 商品详情页（B-2.6 / B-2.7）
 * 信息义务：图片、材质、尺寸、重量、保养、过敏提示、库存状态、手工说明、不可复刻提示
 * 加购属 m-1c：本页只渲染按钮位并明确禁用，不做假交互。
 */
export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = getProductBySlug(slug);
  if (!product) notFound();

  const sold = isSoldOut(product);
  const isOneOfAKind = product.productType === "one_of_a_kind";
  const low = lowStockLabel(product);

  // 相似风格留位：m-1d 用标签相似度填充，此处先按同品类回退（03 §7 兜底）
  const similar = getProductsByCollection(product.category)
    .filter((p) => p.slug !== product.slug)
    .slice(0, 4);

  return (
    <article className="pb-sp6">
      <div className="md:grid md:grid-cols-2 md:gap-sp6 md:px-sp4 md:pt-sp5">
        <ProductGallery images={product.images} title={product.title} />

        <div className="shell pt-sp5 md:px-0">
          {isOneOfAKind ? (
            <span className="inline-block rounded-btn bg-accent px-sp2 py-sp1 text-[10px] uppercase tracking-[0.12em] text-white">
              One of a Kind
            </span>
          ) : null}

          <h1 className="mt-sp2 font-serif text-h1 text-ink">{product.title}</h1>

          <p className="mt-sp2 text-body">
            {sold ? (
              <span className="text-sold line-through">
                {formatPrice(product.price, product.currency)}
              </span>
            ) : (
              <span className="text-ink">{formatPrice(product.price, product.currency)}</span>
            )}
          </p>

          {sold ? (
            <p className="mt-sp1 text-aux uppercase tracking-[0.16em] text-sold">
              {soldLabel(product)}
            </p>
          ) : low ? (
            <p className="mt-sp1 text-aux text-warn">{low}</p>
          ) : null}

          <p className="mt-sp4 max-w-[52ch] text-body text-muted">{product.shortCopy}</p>

          {/* 事实区块：默认收起，过敏与手工说明常显（05 §2.3） */}
          <div className="mt-sp5 divide-y divide-line border-y border-line">
            <FactRow label="Material" value={product.materials.join(", ")} />
            <FactRow
              label="Size"
              value={
                [product.dimensions.length, product.dimensions.width, product.dimensions.diameter]
                  .filter(Boolean)
                  .join(" × ") || "—"
              }
            />
            <FactRow label="Weight" value={`${product.weight.value} ${product.weight.unit}`} />
            {product.closureType ? <FactRow label="Closure" value={product.closureType} /> : null}
            {product.sizeOptions?.length ? (
              <FactRow label="Sizes" value={product.sizeOptions.join(" / ")} />
            ) : null}
            <FactRow label="Care" value={product.careInstructions} />
          </div>

          <div className="mt-sp4 space-y-sp3">
            <p className="text-aux text-warn">⚠ {product.allergyNotice}</p>
            {product.handmadeVariation ? (
              <p className="text-aux text-muted">ℹ {product.handmadeVariation}</p>
            ) : null}
            {product.oneOfAKindNote ? (
              <p className="text-aux text-muted">ℹ {product.oneOfAKindNote}</p>
            ) : null}
          </div>

          {product.highlights?.length ? (
            <ul className="mt-sp4 flex flex-wrap gap-sp2">
              {product.highlights.map((h) => (
                <li
                  key={h}
                  className="rounded-btn bg-accentWeak px-sp3 py-sp1 text-aux text-ink"
                >
                  {h}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-sp5">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="h-12 w-full rounded-btn bg-accent text-body text-white disabled:opacity-40"
            >
              {sold ? soldLabel(product) : "Add to cart"}
            </button>
            <p className="mt-sp2 text-aux text-muted">
              Cart and checkout open with V0.3 (m-1c).
            </p>
            <Link href="/policies/shipping" className="mt-sp3 inline-block text-aux text-muted underline">
              Shipping &amp; returns
            </Link>
          </div>

          <p className="mt-sp4 text-aux text-muted">
            Category: {tagLabel(product.category)} · Style:{" "}
            {product.tags.style.map(tagLabel).join(", ")}
          </p>
        </div>
      </div>

      <section className="mt-sp6">
        <div className="shell">
          <h2 className="text-h2 text-ink">Similar style</h2>
          <p className="mt-sp1 text-aux text-muted">
            Personalised recommendations arrive with V1.0; showing same category for now.
          </p>
        </div>
        <div className="mt-sp3 flex gap-sp4 overflow-x-auto px-sp4 pb-sp2">
          {similar.map((p) => (
            <div key={p.slug} className="w-[46%] shrink-0 sm:w-[220px]">
              <ProductCard product={p} />
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <details className="group">
      <summary className="flex min-h-[44px] cursor-pointer items-center justify-between text-body text-ink">
        {label}
        <span className="text-muted">+</span>
      </summary>
      <p className="pb-sp3 text-body text-muted">{value}</p>
    </details>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = getProductBySlug(slug);
  if (!product) return { title: "Product" };

  return {
    title: product.seoTitle ?? product.title,
    description: product.seoDescription ?? product.shortCopy,
  };
}

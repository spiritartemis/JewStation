import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductGallery } from "@/components/product/ProductGallery";
import { ProductCard } from "@/components/product/ProductCard";
import { ProductOptions } from "@/components/product/ProductOptions";
import { JsonLdScript } from "@/components/JsonLd";
import { getProductBySlug, getProductsByCollection } from "@/lib/products";
import { isSoldOut, localizeProduct, lowStockLabel, soldLabel } from "@/lib/types";
import { tagLabel } from "@/lib/tags";
import { buildMetadata } from "@/lib/seo";
import { breadcrumbJsonLd, productJsonLd } from "@/lib/structured-data";
import { ApproxPrice, Price } from "@/components/currency/Price";
import { DEFAULT_LOCALE, isLocale, localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/**
 * 商品详情页（B-2.6 / B-2.7）
 * 信息义务：图片、材质、尺寸、重量、保养、过敏提示、库存状态、手工说明、不可复刻提示
 * 可选规格（Q-06）：手链开口/死圈、戒指码数在 options 里，同款不同规格
 * 加购属 m-1c：本页只渲染按钮位并明确禁用，不做假交互。
 */
type PageProps = { params: Promise<{ locale: string; slug: string }> };

export default async function ProductPage({ params }: PageProps) {
  const { locale: raw, slug } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const m = getMessages(locale);

  const found = getProductBySlug(slug);
  if (!found) notFound();

  // 文案本地化：中文取 i18n.zh 覆盖，缺字段回退英文底稿
  const product = localizeProduct(found, locale);

  const sold = isSoldOut(product);
  const isOneOfAKind = product.productType === "one_of_a_kind";
  const low = lowStockLabel(product, locale);

  // 相似风格留位：m-1d 用标签相似度填充，此处先按同品类回退（03 §7 兜底）
  const similar = getProductsByCollection(product.category)
    .filter((p) => p.slug !== product.slug)
    .slice(0, 4);

  const crumbs = [
    { name: m.common.home, path: "/" },
    { name: tagLabel(product.category, locale), path: `/collections/${product.category}` },
    { name: product.title, path: `/products/${product.slug}` },
  ];

  // 尺寸可能只有其中一项；全部缺失时明确写 Not specified，不 misleading 地留 —
  const sizeParts = [
    product.dimensions.length,
    product.dimensions.width,
    product.dimensions.diameter,
  ].filter(Boolean);

  return (
    <article className="pb-sp6">
      <JsonLdScript
        data={[
          productJsonLd(found, locale),
          breadcrumbJsonLd(
            crumbs.map((c) => ({ name: c.name, path: localePath(locale, c.path) })),
          ),
        ]}
      />

      {/* 面包屑：给用户明确的位置感，也让搜索引擎拿到层级 */}
      <nav aria-label={m.product.breadcrumb} className="shell pt-sp4">
        <ol className="flex flex-wrap items-center gap-sp2 text-aux text-muted">
          {crumbs.map((c, i) => (
            <li key={c.path} className="flex items-center gap-sp2">
              {i > 0 ? <span aria-hidden="true">/</span> : null}
              {i === crumbs.length - 1 ? (
                <span aria-current="page" className="text-ink">
                  {c.name}
                </span>
              ) : (
                <Link href={localePath(locale, c.path)} className="hover:text-accent">
                  {c.name}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <div className="md:grid md:grid-cols-2 md:gap-sp6 md:px-sp4 md:pt-sp5">
        <ProductGallery images={product.images} title={product.title} locale={locale} />

        <div className="shell pt-sp5 md:px-0">
          {isOneOfAKind ? (
            <span className="inline-block rounded-btn bg-accent px-sp2 py-sp1 text-[10px] uppercase tracking-[0.12em] text-onAccent">
              {m.product.oneOfAKindBadge}
            </span>
          ) : null}

          <h1 className="mt-sp2 font-serif text-h1 text-ink">{product.title}</h1>

          <div className="mt-sp2 flex flex-wrap items-baseline gap-sp3">
            <Price
              usd={product.price}
              className={sold ? "text-body text-sold line-through" : "text-body text-ink"}
            />
            {/* 另一种币种的约值：说明这是展示换算，不是结算价（Q-05 / Q-08） */}
            <ApproxPrice usd={product.price} className="text-aux text-muted" />
          </div>

          {sold ? (
            <p className="mt-sp1 text-aux uppercase tracking-[0.16em] text-sold">
              {soldLabel(product, locale)}
            </p>
          ) : low ? (
            <p className="mt-sp1 text-aux text-warn">{low}</p>
          ) : null}

          <p className="mt-sp4 max-w-[52ch] text-body text-muted">{product.shortCopy}</p>
          {/* 长描述：卡片的 shortCopy 只有一句，详情页要把工艺/场景讲清楚（B-2.6 内容义务） */}
          {product.description && product.description !== product.shortCopy ? (
            <p className="mt-sp3 max-w-[52ch] text-body text-muted">{product.description}</p>
          ) : null}

          {/* 可选规格（Q-06）：同一款的不同做法，不是一个新商品 */}
          {product.options?.length ? (
            <ProductOptions options={product.options} locale={locale} />
          ) : null}

          {/* 事实区块：默认收起，过敏与手工说明常显（05 §2.3） */}
          <div className="mt-sp5 divide-y divide-line border-y border-line">
            <FactRow label={m.product.material} value={product.materials.join(", ")} />
            <FactRow
              label={m.product.size}
              value={
                sizeParts.length
                  ? `${sizeParts.join(" × ")} ${product.dimensions.unit}`
                  : m.common.notSpecified
              }
            />
            <FactRow label={m.product.weight} value={`${product.weight.value} ${product.weight.unit}`} />
            {product.closureType ? (
              <FactRow label={m.product.closure} value={product.closureType} />
            ) : null}
            {product.sizeOptions?.length ? (
              <FactRow label={m.product.sizes} value={product.sizeOptions.join(" / ")} />
            ) : null}
            <FactRow label={m.product.care} value={product.careInstructions} />
          </div>

          <div className="mt-sp4 space-y-sp3">
            <p className="text-aux text-warn">⚠ {product.allergyNotice}</p>
            {product.handmadeVariation ? (
              <p className="text-aux text-muted">ℹ {product.handmadeVariation}</p>
            ) : null}
            {product.oneOfAKindNote ? (
              <p className="text-aux text-muted">ℹ {product.oneOfAKindNote}</p>
            ) : null}
            {/* Q-28：耳饰非质量问题不退，商品页与政策页都要写明 */}
            {product.category === "earrings" ? (
              <p className="text-aux text-muted">ℹ {m.product.earringsFinalSale}</p>
            ) : null}
          </div>

          {product.highlights?.length ? (
            <ul className="mt-sp4 flex flex-wrap gap-sp2">
              {product.highlights.map((h) => (
                <li key={h} className="rounded-btn bg-accentWeak px-sp3 py-sp1 text-aux text-ink">
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
              aria-describedby="cart-note"
              className="h-12 w-full rounded-btn bg-accent text-body text-onAccent disabled:opacity-40"
            >
              {sold ? soldLabel(product, locale) : m.product.addToCart}
            </button>
            <p id="cart-note" className="mt-sp2 text-aux text-muted">
              {sold
                ? isOneOfAKind
                  ? m.product.soldNote
                  : m.product.outOfStockNote
                : m.product.checkoutNote}
            </p>

            {/* 配送口径（Q-21 / Q-22 / Q-30 / Q-32）：在商品页就把发货地、两段时效和税讲清楚，
                不要让用户到结账才发现从中国发货 */}
            <div className="mt-sp3 rounded-btn border border-line bg-surface px-sp3 py-sp2">
              <p className="text-aux text-muted">{m.product.shippingSummary}</p>
              <Link
                href={localePath(locale, "/policies/shipping")}
                className="mt-sp2 inline-block text-aux text-muted underline hover:text-accent"
              >
                {m.product.shippingReturns}
              </Link>
            </div>
          </div>

          <p className="mt-sp4 text-aux text-muted">
            {m.product.categoryLabel}: {tagLabel(product.category, locale)} ·{" "}
            {m.product.styleLabel}: {product.tags.style.map((s) => tagLabel(s, locale)).join(", ")}
          </p>
        </div>
      </div>

      <section className="mt-sp6">
        <div className="shell">
          <h2 className="text-h2 text-ink">{m.product.similar}</h2>
          <p className="mt-sp1 text-aux text-muted">{m.product.similarNote}</p>
        </div>
        <div className="mt-sp3 flex gap-sp4 overflow-x-auto px-sp4 pb-sp2">
          {similar.map((p) => (
            <div key={p.slug} className="w-[46%] shrink-0 sm:w-[220px]">
              <ProductCard product={p} locale={locale} />
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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const found = getProductBySlug(slug);
  if (!found) {
    const m = getMessages(locale);
    return { title: locale === "zh" ? "商品不存在" : "Product not found", description: m.list.allProducts };
  }

  const product = localizeProduct(found, locale);

  // 原先只返回 title/description，缺 canonical 与 OG——B-2.9 要求每页规范 URL 与分享预览齐备
  return buildMetadata({
    title: product.seoTitle ?? product.title,
    description: product.seoDescription ?? product.shortCopy,
    path: `/products/${product.slug}`,
    locale,
  });
}

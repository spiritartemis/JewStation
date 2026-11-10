import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductGallery } from "@/components/product/ProductGallery";
import { BackLink } from "@/components/product/BackLink";
import { ProductCard } from "@/components/product/ProductCard";
import { ProductOptions, ProductOptionNote } from "@/components/product/ProductOptions";
import { AddToCart } from "@/components/cart/AddToCart";
import { ViewTracker } from "@/components/privacy/ViewTracker";
import { JsonLdScript } from "@/components/JsonLd";
import { getAllProducts, getProductBySlug, getProductsByCollection } from "@/lib/products";
import {
  isSoldOut,
  localizeProduct,
  lowStockLabel,
  soldLabel,
  specGroupsOf,
} from "@/lib/types";
import { ProductSpecProvider } from "@/components/product/ProductSpecContext";
import { ProductFactList } from "@/components/product/ProductFactList";
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
  // 规格组：显式的 options（开口/死圈）+ 由 sizeOptions 提升的尺码组，合并成一份给选择器与事实行共用
  const specGroups = specGroupsOf(product, locale);

  const sold = isSoldOut(product);
  const isOneOfAKind = product.productType === "one_of_a_kind";
  const low = lowStockLabel(product, locale);

  // 相似风格（m-1d 会用标签相似度正式实现）
  // 2026-11-02：原先只按同品类取，戒指只有一个款时列表被自己过滤空 ——
  // 页面上仍然渲染标题与说明，下面却一片空白。改成三级兜底：
  // 同品类 → 同风格 → 全站除自己，保证有商品就一定填得满。
  const similar = (() => {
    const all = getAllProducts();
    const sameCategory = getProductsByCollection(product.category).filter(
      (p) => p.slug !== product.slug,
    );
    if (sameCategory.length) return sameCategory.slice(0, 4);
    const sameStyle = all.filter(
      (p) =>
        p.slug !== product.slug && p.tags.style.some((s) => product.tags.style.includes(s)),
    );
    if (sameStyle.length) return sameStyle.slice(0, 4);
    return all.filter((p) => p.slug !== product.slug).slice(0, 4);
  })();

  const crumbs = [
    { name: m.common.home, path: "/" },
    { name: tagLabel(product.category, locale), path: `/collections/${product.category}` },
    { name: product.title, path: `/products/${product.slug}` },
  ];

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

      {/* 返回（2026-11-03）：走浏览器历史，才能连滚动位置一起回到刚才那一屏；
          直接打开分享链接（站内无上一页）时退到品类列表，不会把人送出站外 */}
      <div className="shell pt-sp4">
        <BackLink
          label={m.product.back}
          fallbackHref={localePath(locale, `/collections/${product.category}`)}
        />
      </div>

      {/* 面包屑：给用户明确的位置感，也让搜索引擎拿到层级 */}
      <nav aria-label={m.product.breadcrumb} className="shell pt-sp2">
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

        {/* 规格选中态在「选择器」与「事实行」两处共享，故由 Provider 包住整列 */}
        <ProductSpecProvider options={specGroups}>
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

          {/* 可选规格（Q-06）：同一款的不同做法，不是一个新商品
              只有一种做法时不渲染芯片，做法直接写在下方「开合方式」行 */}
          <ProductOptions locale={locale} />
          <ProductOptionNote locale={locale} />

          {/* 事实区块：默认收起，过敏与手工说明常显（05 §2.3）
              「尺寸」跟随所选尺码、「开合方式」跟随所选做法，故整块交给客户端组件 */}
          <ProductFactList
            product={product}
            locale={locale}
            labels={{
              material: m.product.material,
              size: m.product.size,
              weight: m.product.weight,
              closure: m.product.closure,
              sizes: m.product.sizes,
              care: m.product.care,
              notSpecified: m.common.notSpecified,
            }}
          />

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
            {/* 浏览上报（0.5.0 / 1.0-03）：只有同意个性化才会真的发请求，见组件内注释。
                标签带维度前缀，0.6.0 的按标签匹配要靠它区分「银」是材质还是风格 */}
            <ViewTracker
              slug={product.slug}
              tags={[
                `category:${product.category}`,
                ...product.tags.style.map((t) => `style:${t}`),
                ...product.tags.material.map((t) => `material:${t}`),
                ...(product.tags.occasion ?? []).map((t) => `occasion:${t}`),
                ...(product.tags.collection ?? []).map((t) => `collection:${t}`),
              ]}
            />

            {/* 加购（m-1c / 1c-0）：所选规格随条目进袋，孤品上限 1 件 */}
            <AddToCart product={product} locale={locale} />

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
        </ProductSpecProvider>
      </div>

      {similar.length ? (
        <section className="mt-sp6">
          {/* 标题与卡片放进同一个 .shell：原先卡片用 px-sp4 贴着屏幕边，
              标题却落在 1200px 栏里，1440 宽下两者差 84px，看着像两个区块 */}
          <div className="shell">
            <h2 className="text-h2 text-ink">{m.product.similar}</h2>
            <p className="mt-sp1 text-aux text-muted">{m.product.similarNote}</p>

            {similar.length <= 2 ? (
              // 1–2 件时用大卡两列，否则横滑条右侧会空掉大半屏
              <div className="mt-sp4 grid gap-sp5 sm:grid-cols-2">
                {similar.map((p) => (
                  <ProductCard key={p.slug} product={p} locale={locale} size="feature" />
                ))}
              </div>
            ) : (
              <div className="mt-sp4 flex gap-sp4 overflow-x-auto pb-sp2">
                {similar.map((p) => (
                  <div key={p.slug} className="w-[46%] shrink-0 sm:w-[220px]">
                    <ProductCard product={p} locale={locale} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}
    </article>
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

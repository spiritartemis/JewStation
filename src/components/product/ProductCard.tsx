import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/lib/types";
import { isSoldOut, localizeProduct, lowStockLabel, soldLabel } from "@/lib/types";
import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { Price } from "@/components/currency/Price";

/**
 * 商品卡片（B-2.4 / 05 §4）
 * - 商品类型标记（One of a Kind 实心角标）、价格、主图、售罄状态在列表中可见
 * - 手工/孤品：1px 暖调描边 + 实心角标；可补货：库存 ≤3 显示 Only N left
 * - 差异不依赖颜色单一通道：角标是文字，不靠颜色传达（无障碍）
 * - 价格走 <Price>，按当前展示币种换算（Q-05 / Q-08）
 *
 * 图片：无实拍图时渲染占位块，绝不拿 AI 生成图冒充商品图（m-1b bootstrap §5）。
 */
export function ProductCard({
  product: raw,
  locale,
  priority = false,
  size = "rail",
}: {
  product: Product;
  locale: Locale;
  /** 首屏首行的卡片传 true：否则 LCP 图会被延迟加载拖慢（B-2.10） */
  priority?: boolean;
  /**
   * rail：横滑条里的窄卡（默认）；
   * feature：区块只有 1–2 件时用的大卡（两列填满容器，避免右侧大片空白）
   */
  size?: "rail" | "feature";
}) {
  const m = getMessages(locale);
  const product = localizeProduct(raw, locale);
  const primary = product.images.find((i) => i.isPrimary) ?? product.images[0];
  const sold = isSoldOut(product);
  const low = lowStockLabel(product, locale);
  const isOneOfAKind = product.productType === "one_of_a_kind";
  const feature = size === "feature";

  return (
    <Link
      href={localePath(locale, `/products/${product.slug}`)}
      className={`block ${isOneOfAKind ? "rounded-card border border-accentWeak" : ""} ${
        isOneOfAKind ? "p-sp2" : ""
      }`}
    >
      <div
        className={`relative overflow-hidden rounded-img bg-accentWeak ${
          feature ? "aspect-[3/4]" : ""
        }`}
      >
        {primary ? (
          <Image
            src={primary.url}
            alt={primary.alt}
            width={primary.width}
            height={primary.height}
            // feature 卡占半屏宽，sizes 必须跟着放大，否则浏览器只取 240px 的模糊图
            sizes={
              feature
                ? "(max-width: 640px) 92vw, 46vw"
                : "(max-width: 768px) 46vw, (max-width: 1024px) 30vw, 240px"
            }
            priority={priority}
            loading={priority ? undefined : "lazy"}
            className={`w-full object-cover ${feature ? "h-full" : "h-auto"} ${
              // 售罄：图片本身去色，比铺半透明蒙版更干净；浅底上蒙版几乎等于没盖
              sold ? "grayscale" : ""
            }`}
          />
        ) : (
          <div className="flex aspect-[4/5] w-full items-center justify-center">
            <span className="text-aux text-muted">{m.product.photoPending}</span>
          </div>
        )}

        {isOneOfAKind ? (
          <span className="absolute left-sp2 top-sp2 rounded-btn bg-accent px-sp2 py-sp1 text-[10px] uppercase tracking-[0.12em] text-onAccent">
            {m.product.oneOfAKindBadge}
          </span>
        ) : null}

        {sold ? (
          <>
            {/* 薄雾：只压掉一点亮度，让墨色标签浮起来 */}
            <span aria-hidden className="absolute inset-0 bg-bg/30" />
            {/* 标签居中：浅底 + 去色图之上，墨色胶囊才有足够对比（白字 4.6:1 以上）。
                feature 大卡上标签要跟着放大，否则在 580px 宽的图里像一颗小痣 */}
            <span className="absolute inset-0 flex items-center justify-center">
              <span
                className={`rounded-btn border border-white/25 bg-ink/85 uppercase tracking-[0.2em] text-white ${
                  feature ? "px-sp4 py-sp2 text-body" : "px-sp3 py-sp1 text-aux"
                }`}
              >
                {soldLabel(product, locale)}
              </span>
            </span>
          </>
        ) : null}
      </div>

      <div className={feature ? "mt-sp4" : "mt-sp3"}>
        <h3 className={`line-clamp-2 text-ink ${feature ? "font-serif text-h1" : "text-body"}`}>
          {product.title}
        </h3>
        <p className="mt-sp1 text-body">
          <Price
            usd={product.price}
            className={sold ? "text-sold line-through" : "text-ink"}
          />
        </p>
        {!sold && low ? <p className="mt-sp1 text-aux text-warn">{low}</p> : null}
      </div>
    </Link>
  );
}

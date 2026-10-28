import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/lib/types";
import { formatPrice, isSoldOut, lowStockLabel, soldLabel } from "@/lib/types";

/**
 * 商品卡片（B-2.4 / 05 §4）
 * - 商品类型标记（One of a Kind 实心角标）、价格、主图、售罄状态在列表中可见
 * - 手工/孤品：1px 暖调描边 + 实心角标；可补货：库存 ≤3 显示 Only N left
 * - 差异不依赖颜色单一通道：角标是文字，不靠颜色传达（无障碍）
 *
 * 图片：样例数据无实拍图时渲染占位块，绝不拿 AI 生成图冒充商品图（m-1b bootstrap §5）。
 */
export function ProductCard({
  product,
  priority = false,
}: {
  product: Product;
  /** 首屏首行的卡片传 true：否则 LCP 图会被延迟加载拖慢（B-2.10） */
  priority?: boolean;
}) {
  const primary = product.images.find((i) => i.isPrimary) ?? product.images[0];
  const sold = isSoldOut(product);
  const low = lowStockLabel(product);
  const isOneOfAKind = product.productType === "one_of_a_kind";

  return (
    <Link
      href={`/products/${product.slug}`}
      className={`group block ${isOneOfAKind ? "rounded-card border border-accentWeak" : ""} ${
        isOneOfAKind ? "p-sp2" : ""
      }`}
    >
      <div className="relative overflow-hidden rounded-img bg-accentWeak">
        {primary ? (
          <Image
            src={primary.url}
            alt={primary.alt}
            width={primary.width}
            height={primary.height}
            sizes="(max-width: 768px) 46vw, (max-width: 1024px) 30vw, 240px"
            priority={priority}
            loading={priority ? undefined : "lazy"}
            className="h-auto w-full object-cover"
          />
        ) : (
          <div className="flex aspect-[4/5] w-full items-center justify-center">
            <span className="text-aux text-muted">Photo pending</span>
          </div>
        )}

        {isOneOfAKind ? (
          <span className="absolute left-sp2 top-sp2 rounded-btn bg-accent px-sp2 py-sp1 text-[10px] uppercase tracking-[0.12em] text-white">
            One of a Kind
          </span>
        ) : null}

        {sold ? (
          <span className="absolute inset-0 flex items-center justify-center bg-bg/70 text-body uppercase tracking-[0.16em] text-sold">
            {soldLabel(product)}
          </span>
        ) : null}
      </div>

      <div className="mt-sp3">
        <h3 className="line-clamp-2 text-body text-ink">{product.title}</h3>
        <p className="mt-sp1 text-body">
          {sold ? (
            <span className="text-sold line-through">{formatPrice(product.price, product.currency)}</span>
          ) : (
            <span className="text-ink">{formatPrice(product.price, product.currency)}</span>
          )}
        </p>
        {!sold && low ? <p className="mt-sp1 text-aux text-warn">{low}</p> : null}
      </div>
    </Link>
  );
}

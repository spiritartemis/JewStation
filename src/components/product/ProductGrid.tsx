import { ProductCard } from "./ProductCard";
import type { Product } from "@/lib/types";
import type { Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/** 首屏优先级窗口：移动端 2 列 = 2 行 4 张；桌面 4 列 = 1 行 4 张（B-2.10） */
const PRIORITY_COUNT = 4;

/** 商品网格：移动端 2 列（05 §2.2），桌面顺延为 3–4 列，不做桌面专属布局 */
export function ProductGrid({ products, locale }: { products: Product[]; locale: Locale }) {
  // 只有 1–2 件时改用大卡：4 列网格里放 1 张卡，右边会空出一整屏白（新品类刚开张就是这种状态）
  if (products.length <= 2 && products.length > 0) {
    return (
      <div className="shell grid max-w-[880px] gap-sp5 sm:grid-cols-2">
        {products.map((p, i) => (
          <ProductCard
            key={p.slug}
            product={p}
            locale={locale}
            size="feature"
            priority={i === 0}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="shell grid grid-cols-2 gap-sp5 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p, i) => (
        <ProductCard key={p.slug} product={p} locale={locale} priority={i < PRIORITY_COUNT} />
      ))}
    </div>
  );
}

/** 空态（01 §5：每个页面都要有空态） */
export function ProductGridEmpty({
  locale,
  onClear,
}: {
  locale: Locale;
  onClear?: React.ReactNode;
}) {
  const m = getMessages(locale);
  return (
    <div className="shell py-sp6 text-center">
      <p className="text-body text-muted">{m.list.noMatch}</p>
      {onClear ? <div className="mt-sp4 flex justify-center">{onClear}</div> : null}
    </div>
  );
}

import { Section, type SectionTone } from "@/components/Section";
import { ProductCard } from "@/components/product/ProductCard";
import type { Product } from "@/lib/types";

/**
 * 横向滑动商品条（05 §2.1：横向滑动卡片，不截端）
 *
 * layout="pair"：商品只有 1–2 件时改用两列大卡填满容器。
 * 横滑条按固定卡宽（220px）排列，2 件商品只占 440px，在 1200px 容器里会空出小半屏；
 * 孤品区恰恰经常只有 1–2 件，所以这里按数量切布局，不留假空白。
 */
export function ProductRail({
  title,
  products,
  href,
  tone,
  description,
  layout = "rail",
}: {
  title: string;
  products: Product[];
  href?: string;
  /** 区块底色：手工孤品 / 流行款用不同莫兰迪色相做区分（B-1.7） */
  tone?: SectionTone;
  /** 标题下的一句说明（只在需要解释区块规则时传） */
  description?: string;
  layout?: "rail" | "pair";
}) {
  if (products.length === 0) return null;

  if (layout === "pair") {
    return (
      <Section title={title} href={href} tone={tone} description={description}>
        <div className="shell grid gap-sp5 sm:grid-cols-2">
          {products.map((p, i) => (
            <ProductCard key={p.slug} product={p} size="feature" priority={i === 0} />
          ))}
        </div>
      </Section>
    );
  }

  return (
    <Section title={title} href={href} tone={tone} description={description}>
      <div className="flex gap-sp4 overflow-x-auto px-sp4 pb-sp2">
        {products.map((p) => (
          <div key={p.slug} className="w-[46%] shrink-0 sm:w-[220px]">
            <ProductCard product={p} />
          </div>
        ))}
      </div>
    </Section>
  );
}

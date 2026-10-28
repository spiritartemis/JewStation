import { Section, type SectionTone } from "@/components/Section";
import { ProductCard } from "@/components/product/ProductCard";
import type { Product } from "@/lib/types";

/** 横向滑动商品条（05 §2.1：横向滑动卡片，不截端） */
export function ProductRail({
  title,
  products,
  href,
  tone,
}: {
  title: string;
  products: Product[];
  href?: string;
  /** 区块底色：手工孤品 / 流行款用不同莫兰迪色相做区分（B-1.7） */
  tone?: SectionTone;
}) {
  if (products.length === 0) return null;

  return (
    <Section title={title} href={href} tone={tone}>
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

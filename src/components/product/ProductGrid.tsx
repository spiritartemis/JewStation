import { ProductCard } from "./ProductCard";
import type { Product } from "@/lib/types";

/** 商品网格：移动端 2 列（05 §2.2），桌面顺延为 3–4 列，不做桌面专属布局 */
export function ProductGrid({ products }: { products: Product[] }) {
  return (
    <div className="shell grid grid-cols-2 gap-sp5 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.slug} product={p} />
      ))}
    </div>
  );
}

/** 空态（01 §5：每个页面都要有空态） */
export function ProductGridEmpty({ onClear }: { onClear?: React.ReactNode }) {
  return (
    <div className="shell py-sp6 text-center">
      <p className="text-body text-muted">No products match these filters.</p>
      {onClear ? <div className="mt-sp4 flex justify-center">{onClear}</div> : null}
    </div>
  );
}

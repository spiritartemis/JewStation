import { PlaceholderPage } from "@/components/PlaceholderPage";
import { buildMetadata } from "@/lib/seo";

// 占位页不进索引：避免搜索引擎收录一个"购物车为空"的空壳页
export const metadata = buildMetadata({
  title: "Cart",
  description: "Your cart is empty. Cart, checkout and orders arrive with V0.3.",
  path: "/cart",
  noindex: true,
});

/** 购物车属 m-1c；本线只保留路由与空态占位，避免导航 404。 */
export default function CartPage() {
  return (
    <PlaceholderPage
      title="Your cart is empty"
      description="Cart, checkout and order confirmation are implemented in m-1c."
    />
  );
}

import { PlaceholderPage } from "@/components/PlaceholderPage";

export const metadata = { title: "Cart" };

/** 购物车属 m-1c；本线只保留路由与空态占位，避免导航 404。 */
export default function CartPage() {
  return (
    <PlaceholderPage
      title="Your cart is empty"
      description="Cart, checkout and order confirmation are implemented in m-1c."
    />
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { optionName, optionValueLabel, type Product } from "@/lib/types";
import { MAX_QTY_PER_LINE, type CartOption } from "@/lib/cart";
import { useProductSpec } from "@/components/product/ProductSpecContext";
import { useCart } from "./CartProvider";

/**
 * 加购按钮（m-1c / 1c-0）
 *
 * 与规格选择器共用 `ProductSpecContext`：用户在页面上选的尺码/开合方式，
 * 必须跟着这一件商品进袋子 —— 否则购物袋里两件看起来一样、实际不同规格的东西会合并成一行。
 *
 * 库存口径（04）：孤品上限 1 件；可补货款按 stock，且不超过单行上限。
 * 售罄时按钮直接禁用并换文案，不做「点了才报错」。
 *
 * 加购成功后按钮原地换成「已加入 · 查看购物袋」2.6 秒 —— 比弹 toast 安静，
 * 也不会挡住页面；读屏用户靠 `aria-live` 拿到同一信息。
 */
export function AddToCart({ product, locale }: { product: Product; locale: Locale }) {
  const m = getMessages(locale);
  const cart = useCart();
  const spec = useProductSpec();
  const [justAdded, setJustAdded] = useState(false);

  const sold = product.stock <= 0;
  const oneOfAKind = product.productType === "one_of_a_kind";
  const maxQty = oneOfAKind ? 1 : Math.max(1, Math.min(MAX_QTY_PER_LINE, product.stock));

  // 规格的展示值随语言走（切语言不会出现「选了中文值、袋里存英文」）
  const options: CartOption[] = (spec?.options ?? [])
    .map((opt) => {
      const index = spec?.selected[opt.name] ?? 0;
      const value = opt.values[index];
      if (!value) return null;
      return { name: optionName(opt, locale), value: optionValueLabel(value, locale) };
    })
    .filter((x): x is CartOption => x !== null);

  const primary = product.images.find((i) => i.isPrimary) ?? product.images[0];

  const onClick = () => {
    if (sold) return;
    cart.add({
      slug: product.slug,
      title: product.title,
      priceUsd: product.price,
      maxQty,
      oneOfAKind,
      options,
      image: primary
        ? { url: primary.url, alt: primary.alt, width: primary.width, height: primary.height }
        : null,
    });
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 2600);
  };

  if (sold) {
    return (
      <div className="mt-sp5">
        <button
          type="button"
          disabled
          aria-disabled="true"
          aria-describedby="cart-note"
          className="h-12 w-full rounded-btn bg-accent text-body text-onAccent disabled:opacity-40"
        >
          {m.product.sold}
        </button>
        <p id="cart-note" className="mt-sp2 text-aux text-muted">
          {oneOfAKind ? m.product.soldNote : m.product.outOfStockNote}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-sp5">
      <div className="flex flex-col gap-sp2 sm:flex-row">
        <button
          type="button"
          onClick={onClick}
          aria-describedby="cart-note"
          className="h-12 flex-1 rounded-btn bg-accent text-body text-onAccent transition-opacity duration-fade hover:opacity-90"
        >
          {m.product.addToCart}
        </button>
        {justAdded ? (
          <Link
            href={localePath(locale, "/cart")}
            className="flex h-12 items-center justify-center rounded-btn border border-accent px-sp5 text-body text-ink hover:bg-accentWeak"
          >
            {m.cart.viewBag}
          </Link>
        ) : null}
      </div>

      {/* 加购反馈：视觉上按钮旁的链接已经说明「可以去看袋子」，这里给读屏一句确认 */}
      <p aria-live="polite" className="sr-only">
        {justAdded ? m.cart.added : ""}
      </p>

      <p id="cart-note" className="mt-sp2 text-aux text-muted">
        {oneOfAKind ? m.cart.oneOfAKindNote : m.product.checkoutNote}
      </p>
    </div>
  );
}

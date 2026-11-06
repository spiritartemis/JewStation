"use client";

import { useRef, useState, type Ref } from "react";
import Link from "next/link";
import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { optionName, optionValueLabel, type Product } from "@/lib/types";
import { MAX_QTY_PER_LINE, type CartOption } from "@/lib/cart";
import { useProductSpec } from "@/components/product/ProductSpecContext";
import { useCart } from "./CartProvider";
import { flyToBag, popBagButton } from "./flyToBag";

/**
 * 加购按钮（m-1c / 1c-0）
 *
 * 与规格选择器共用 `ProductSpecContext`：用户在页面上选的尺码/开合方式，
 * 必须跟着这一件商品进袋子 —— 否则购物袋里两件看起来一样、实际不同规格的东西会合并成一行。
 *
 * 库存口径（04）：孤品上限 1 件；可补货款按 stock，且不超过单行上限。
 * 售罄时按钮直接禁用并换文案，不做「点了才报错」。
 *
 * 「查看购物袋」常驻（0.4.2）：以前只在加购成功后临时冒出 2.6 秒，用户不知道
 * 那个入口会消失，也找不到回去的路。现在两个按钮一直并排，袋里 0 件时
 * 「查看购物袋」打灰不可点，≥1 件才可点。加购成功只做一次轻微高亮 + 读屏播报。
 *
 * 「飞入购物袋」（0.4.3）：加购时一枚带商品缩略图的小徽章从加购按钮飞到
 * 「查看购物袋」按钮，落点再弹一下。动画是纯视觉的，袋子状态在点击瞬间就已写入，
 * 就算动画被系统降级跳过也不影响加购结果。
 */
export function AddToCart({ product, locale }: { product: Product; locale: Locale }) {
  const m = getMessages(locale);
  const cart = useCart();
  const spec = useProductSpec();
  const [justAdded, setJustAdded] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const viewBagRef = useRef<HTMLAnchorElement>(null);

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

    // 先把两端矩形量出来再起飞：cart.add 会触发重渲染，晚量会拿到禁用/可用两种不同样式
    const from = addButtonRef.current?.getBoundingClientRect();
    const to = viewBagRef.current?.getBoundingClientRect();
    if (!from || !to) return;
    flyToBag({
      from,
      to,
      image: primary ? { url: primary.url } : null,
      onLand: () => popBagButton(viewBagRef.current),
    });
  };

  /**
   * 首帧（SSR / hydration 前）一律按空袋渲染打灰态 —— 服务端不知道访客袋里有几件。
   * `ready` 为 false 时也保持禁用，避免「还没读盘就能点进空袋」。
   */
  const canViewBag = cart.ready && cart.count > 0;

  const viewBag = (
    <ViewBagLink
      locale={locale}
      canView={canViewBag}
      highlight={justAdded}
      targetRef={viewBagRef}
    />
  );

  if (sold) {
    return (
      <div className="mt-sp5">
        <div className="flex flex-col gap-sp2 sm:flex-row">
          <button
            type="button"
            disabled
            aria-disabled="true"
            aria-describedby="cart-note"
            className="h-12 flex-1 rounded-btn bg-accent text-body text-onAccent disabled:opacity-40"
          >
            {m.product.sold}
          </button>
          {viewBag}
        </div>
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
          ref={addButtonRef}
          type="button"
          onClick={onClick}
          aria-describedby="cart-note"
          className="h-12 flex-1 rounded-btn bg-accent text-body text-onAccent transition-opacity duration-fade hover:opacity-90"
        >
          {m.product.addToCart}
        </button>
        {viewBag}
      </div>

      {/* 加购反馈：视觉上按钮高亮，读屏靠这一句确认 */}
      <p aria-live="polite" className="sr-only">
        {justAdded ? m.cart.added : ""}
      </p>

      <p id="cart-note" className="mt-sp2 text-aux text-muted">
        {oneOfAKind ? m.cart.oneOfAKindNote : m.product.checkoutNote}
      </p>
    </div>
  );
}

/**
 * 常驻的「查看购物袋」。禁用态仍保留 href（SharecodeKeeper 会给它补分享参数），
 * 但用 aria-disabled + tabIndex=-1 + 拦截点击三重保证：读屏知道它不可用、
 * 键盘 Tab 不会落上去、鼠标点了也不会跳走。
 */
function ViewBagLink({
  locale,
  canView,
  highlight,
  targetRef,
}: {
  locale: Locale;
  canView: boolean;
  highlight: boolean;
  /** 飞入动画的落点：必须是真实 DOM 节点，才能量到视口坐标 */
  targetRef: Ref<HTMLAnchorElement>;
}) {
  const m = getMessages(locale);
  return (
    <>
      <Link
        ref={targetRef}
        href={localePath(locale, "/cart")}
        aria-disabled={!canView}
        aria-describedby={canView ? undefined : "view-bag-hint"}
        tabIndex={canView ? undefined : -1}
        onClick={canView ? undefined : (e) => e.preventDefault()}
        className={`flex h-12 shrink-0 items-center justify-center rounded-btn border px-sp5 text-body transition-colors duration-fade ${
          canView
            ? `border-accent text-ink hover:bg-accentWeak ${highlight ? "bg-accentWeak" : ""}`
            : "cursor-not-allowed border-line text-muted opacity-45"
        }`}
      >
        {m.cart.viewBag}
      </Link>
      {!canView ? (
        <span id="view-bag-hint" className="sr-only">
          {m.cart.viewBagHint}
        </span>
      ) : null}
    </>
  );
}

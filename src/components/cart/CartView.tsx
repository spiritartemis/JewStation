"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { cartTotals, lineTotalUsd, type CartLine } from "@/lib/cart";
import { getProductBySlug } from "@/lib/products";
import { localizeProduct } from "@/lib/types";
import { Price } from "@/components/currency/Price";
import { useCart } from "./CartProvider";

/**
 * 购物袋页主体（m-1c / 1c-0 + 1c-5）
 *
 * 静态化前提：整页不读 URL 参数、不用 useSearchParams —— 袋子内容全部来自 localStorage，
 * 首帧（SSR）渲染的就是空袋骨架，hydration 后再填。这也是为什么需要 `ready`：
 * 没有它，用户会先看到「袋子是空的」再闪成有货，像出了 bug。
 *
 * 金额三处一致（1c-5 判据）：本页、结账页、订单确认页都调同一个 `cartTotals()`。
 *
 * 0.4.9：全选 / 逐条勾选 / 删除所选 / 清空购物袋（二次确认）。
 * 清空只调用 CartProvider.clear()，它只写 `mm.cart.v1`，**不会碰订单历史 `mm.orders.v1`**。
 * 商品名按当前页面语言取目录译名，切语言不会再看到下单时的英文快照。
 */
export function CartView({ locale }: { locale: Locale }) {
  const m = getMessages(locale);
  const { lines, ready, setQty, remove, removeMany, clear } = useCart();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);
  const t = cartTotals(lines);

  // 删掉某条后，勾选集合里不该留着已不存在的 key（否则「已选 N 件」会虚高）
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const keys = new Set(lines.map((l) => l.key));
      const next = new Set([...prev].filter((k) => keys.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [lines]);

  const titleOf = (line: CartLine): string => {
    const found = getProductBySlug(line.slug);
    return found ? localizeProduct(found, locale).title : line.title;
  };

  const allSelected = lines.length > 0 && selected.size === lines.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(lines.map((l) => l.key)));
  const toggleOne = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const removeSelected = () => {
    removeMany([...selected]);
    setSelected(new Set());
  };
  const clearBag = () => {
    clear();
    setSelected(new Set());
    setConfirmClear(false);
  };

  if (!ready) {
    // 一帧的时间，骨架比空态诚实：不告诉用户「你是空的」然后又冒出商品
    return (
      <div className="shell py-sp6">
        <div className="h-8 w-40 animate-pulse rounded-btn bg-accentWeak" />
        <div className="mt-sp5 h-24 w-full animate-pulse rounded-card bg-accentWeak" />
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="shell py-sp7 text-center">
        <h1 className="font-serif text-h1 text-ink">{m.cart.emptyTitle}</h1>
        <p className="mx-auto mt-sp3 max-w-[46ch] text-body text-muted">{m.cart.emptyBody}</p>
        <Link
          href={localePath(locale, "/shop")}
          className="mt-sp5 inline-flex h-12 items-center justify-center rounded-btn bg-accent px-sp6 text-body text-onAccent hover:opacity-90"
        >
          {m.cart.browseAll}
        </Link>
        <Link
          href={localePath(locale, "/orders")}
          className="mt-sp3 block text-aux text-muted underline hover:text-accent"
        >
          {m.nav.orders}
        </Link>
      </div>
    );
  }

  return (
    <div className="shell py-sp5">
      {/* 按件数而不是行数：同一款买了 2 件应该写「2 件」，不是「1 件」 */}
      <h1 className="font-serif text-h1 text-ink">{m.cart.titleWithCount(t.itemCount)}</h1>

      <div className="mt-sp5 grid gap-sp6 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="min-w-0">
          {/* 0.4.9：全选 + 已选计数 */}
          <div className="mb-sp3 flex flex-wrap items-center justify-between gap-sp2 rounded-btn border border-line bg-surface px-sp3 py-sp2">
            <label className="flex min-h-[36px] cursor-pointer items-center gap-sp2 text-body text-ink">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-4 w-4 accent-accent"
              />
              {m.cart.selectAll}
            </label>
            <span className="text-aux text-muted">{m.cart.selectedCount(selected.size)}</span>
          </div>

          <ul className="divide-y divide-line border-y border-line">
            {lines.map((line) => {
              const title = titleOf(line);
              return (
                <li key={line.key} className="flex gap-sp3 py-sp4">
                  <input
                    type="checkbox"
                    checked={selected.has(line.key)}
                    onChange={() => toggleOne(line.key)}
                    aria-label={m.cart.selectItem(title)}
                    className="mt-sp3 h-4 w-4 shrink-0 accent-accent"
                  />
                  <Link
                    href={localePath(locale, `/products/${line.slug}`)}
                    className="relative h-24 w-20 shrink-0 overflow-hidden rounded-img bg-accentWeak"
                  >
                    {line.image ? (
                      <Image
                        src={line.image.url}
                        alt={line.image.alt}
                        width={line.image.width}
                        height={line.image.height}
                        sizes="80px"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </Link>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-sp3">
                      <div className="min-w-0">
                        <Link
                          href={localePath(locale, `/products/${line.slug}`)}
                          className="line-clamp-2 text-body text-ink hover:text-accent"
                        >
                          {title}
                        </Link>
                        {line.options.length ? (
                          <p className="mt-sp1 text-aux text-muted">
                            {line.options.map((o) => `${o.name}: ${o.value}`).join(" · ")}
                          </p>
                        ) : null}
                        {line.oneOfAKind ? (
                          <p className="mt-sp1 text-aux text-warn">{m.cart.oneOfAKindNote}</p>
                        ) : null}
                      </div>
                      <Price usd={lineTotalUsd(line)} className="shrink-0 text-body text-ink" />
                    </div>

                    <div className="mt-sp3 flex items-center gap-sp3">
                      <div className="flex items-center rounded-btn border border-line">
                        <button
                          type="button"
                          onClick={() => setQty(line.key, line.qty - 1)}
                          aria-label={m.cart.decrease(title)}
                          className="flex h-9 w-9 items-center justify-center text-ink disabled:opacity-40"
                          disabled={line.qty <= 1}
                        >
                          −
                        </button>
                        <span className="min-w-8 text-center text-body tabular-nums text-ink" aria-live="polite">
                          {line.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => setQty(line.key, line.qty + 1)}
                          aria-label={m.cart.increase(title)}
                          className="flex h-9 w-9 items-center justify-center text-ink disabled:opacity-40"
                          disabled={line.qty >= line.maxQty}
                        >
                          +
                        </button>
                      </div>

                      {line.qty >= line.maxQty && !line.oneOfAKind ? (
                        <span className="text-aux text-muted">{m.cart.maxReached(line.maxQty)}</span>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => remove(line.key)}
                        className="ml-auto text-aux text-muted underline hover:text-accent"
                      >
                        {m.cart.remove}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* 0.4.9：勾选后才出现的批量删除 */}
          {selected.size > 0 ? (
            <button
              type="button"
              onClick={removeSelected}
              className="mt-sp3 h-11 rounded-btn border border-sold/60 px-sp4 text-body text-sold hover:bg-bg"
            >
              {m.cart.removeSelected(selected.size)}
            </button>
          ) : null}
        </div>

        <aside className="rounded-card border border-line bg-surface p-sp4">
          <h2 className="text-h2 text-ink">{m.cart.summary}</h2>

          <dl className="mt-sp3 space-y-sp2 text-body">
            <div className="flex justify-between">
              <dt className="text-muted">{m.cart.subtotal}</dt>
              <dd>
                <Price usd={t.subtotalUsd} className="text-ink" />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">{m.cart.shipping}</dt>
              <dd>
                {t.shippingUsd === 0 ? (
                  <span className="text-ink">{m.cart.freeShipping}</span>
                ) : (
                  <Price usd={t.shippingUsd} className="text-ink" />
                )}
              </dd>
            </div>
            <div className="flex justify-between border-t border-line pt-sp2">
              <dt className="text-ink">{m.cart.total}</dt>
              <dd>
                <Price usd={t.totalUsd} className="text-h2 text-ink" />
              </dd>
            </div>
          </dl>

          <p className="mt-sp2 text-aux text-muted">{m.cart.taxNote}</p>

          {!t.freeShippingReached ? (
            <p className="mt-sp3 rounded-btn bg-accentWeak px-sp3 py-sp2 text-aux text-ink">
              {m.cart.freeShippingHintPrefix}{" "}
              <Price usd={t.freeShippingRemainUsd} className="text-ink" />{" "}
              {m.cart.freeShippingHintSuffix}
            </p>
          ) : null}

          <Link
            href={localePath(locale, "/checkout")}
            className="mt-sp4 flex h-12 w-full items-center justify-center rounded-btn bg-accent text-body text-onAccent hover:opacity-90"
          >
            {m.cart.checkout}
          </Link>

          <Link
            href={localePath(locale, "/shop")}
            className="mt-sp3 block text-center text-aux text-muted underline hover:text-accent"
          >
            {m.cart.continueShopping}
          </Link>

          <Link
            href={localePath(locale, "/orders")}
            className="mt-sp2 block text-center text-aux text-muted underline hover:text-accent"
          >
            {m.nav.orders}
          </Link>

          {/* 0.4.9：清空购物袋，先二次确认再执行；只清袋子，不动订单历史 */}
          <div className="mt-sp4 border-t border-line pt-sp3">
            {confirmClear ? (
              <div>
                <p className="text-aux text-muted">{m.cart.clearBagConfirm}</p>
                <div className="mt-sp2 flex gap-sp2">
                  <button
                    type="button"
                    onClick={clearBag}
                    className="h-10 flex-1 rounded-btn border border-sold/60 text-body text-sold hover:bg-bg"
                  >
                    {m.cart.confirmClear}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="h-10 flex-1 rounded-btn border border-line text-body text-ink hover:bg-accentWeak"
                  >
                    {m.cart.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="h-11 w-full rounded-btn border border-line text-body text-muted hover:border-sold/60 hover:text-sold"
              >
                {m.cart.clearBag}
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { cartTotals, lineTotalUsd } from "@/lib/cart";
import { Price } from "@/components/currency/Price";
import { useCart } from "@/components/cart/CartProvider";

/**
 * 结账表单（m-1c / 1c-1）
 *
 * 提交前不扣库存：真正扣减发生在 `/api/checkout`（服务端原子预占）。
 * 这样用户填地址填到一半放弃，不会把孤品锁死。
 *
 * 金额一律服务端重算，这里展示的合计只是「用户看到的价」；
 * 两者不一致时以服务端为准（页面会在下单后跳支付页，显示的是服务端返回的金额）。
 */
type Field = "email" | "name" | "line1" | "line2" | "city" | "postalCode" | "phone" | "notes";

export function CheckoutForm({ locale }: { locale: Locale }) {
  const m = getMessages(locale);
  const router = useRouter();
  const { lines, ready, clear } = useCart();
  const [country, setCountry] = useState<"US" | "CN">("US");
  const [values, setValues] = useState<Record<Field, string>>({
    email: "",
    name: "",
    line1: "",
    line2: "",
    city: "",
    postalCode: "",
    phone: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = cartTotals(lines);
  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale,
          email: values.email,
          shipTo: {
            name: values.name,
            email: values.email,
            line1: values.line1,
            line2: values.line2 || undefined,
            city: values.city,
            postalCode: values.postalCode,
            country,
            phone: values.phone || undefined,
          },
          lines: lines.map((l) => ({ slug: l.slug, qty: l.qty, options: l.options })),
        }),
      });

      const data = (await res.json()) as {
        ok: boolean;
        orderId?: string;
        token?: string;
        code?: string;
        slug?: string;
      };

      if (!res.ok || !data.ok) {
        const map: Record<string, string> = {
          empty_cart: m.checkout.errEmptyCart,
          invalid_email: m.checkout.errInvalidEmail,
          invalid_address: m.checkout.errInvalidAddress,
          qty_limit: m.checkout.errQtyLimit,
          out_of_stock: m.checkout.errOutOfStock(data.slug ?? ""),
          unknown_product: m.checkout.errUnknownProduct,
          store_unavailable: m.checkout.errStoreUnavailable,
        };
        setError(map[data.code ?? ""] ?? m.checkout.errGeneric);
        setBusy(false);
        return;
      }

      // 订单已在服务端落库并预占库存，客户端袋子可以清掉；
      // 支付页用订单号 + 口令，不依赖本地状态
      clear();
      router.push(
        `${localePath(locale, `/pay/${data.orderId}`)}?token=${encodeURIComponent(data.token ?? "")}`,
      );
    } catch {
      setError(m.checkout.errGeneric);
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <div className="shell py-sp6">
        <div className="h-8 w-32 animate-pulse rounded-btn bg-accentWeak" />
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="shell py-sp7 text-center">
        <h1 className="font-serif text-h1 text-ink">{m.checkout.emptyTitle}</h1>
        <p className="mt-sp3 text-body text-muted">{m.checkout.emptyBody}</p>
        <Link
          href={localePath(locale, "/shop")}
          className="mt-sp5 inline-flex h-12 items-center justify-center rounded-btn bg-accent px-sp6 text-body text-onAccent"
        >
          {m.cart.browseAll}
        </Link>
      </div>
    );
  }

  const inputClass =
    "mt-sp1 h-11 w-full rounded-btn border border-line bg-bg px-sp3 text-body text-ink placeholder:text-muted focus:border-accent focus:outline-none";
  const labelClass = "block text-aux text-muted";

  return (
    <div className="shell py-sp5">
      <h1 className="font-serif text-h1 text-ink">{m.checkout.title}</h1>

      <div className="mt-sp5 grid gap-sp6 lg:grid-cols-[1fr_340px] lg:items-start">
        <form onSubmit={submit} className="space-y-sp5">
          <section>
            <h2 className="text-h2 text-ink">{m.checkout.contact}</h2>
            <label className={`mt-sp3 ${labelClass}`} htmlFor="email">
              {m.checkout.email}
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={values.email}
              onChange={set("email")}
              className={inputClass}
            />
            <p className="mt-sp1 text-aux text-muted">{m.checkout.emailHint}</p>
          </section>

          <section>
            <h2 className="text-h2 text-ink">{m.checkout.address}</h2>

            <label className={`mt-sp3 ${labelClass}`} htmlFor="name">
              {m.checkout.name}
            </label>
            <input
              id="name"
              required
              autoComplete="name"
              value={values.name}
              onChange={set("name")}
              className={inputClass}
            />

            <label className={`mt-sp3 ${labelClass}`} htmlFor="line1">
              {m.checkout.line1}
            </label>
            <input
              id="line1"
              required
              autoComplete="address-line1"
              value={values.line1}
              onChange={set("line1")}
              className={inputClass}
            />

            <label className={`mt-sp3 ${labelClass}`} htmlFor="line2">
              {m.checkout.line2}
            </label>
            <input
              id="line2"
              autoComplete="address-line2"
              value={values.line2}
              onChange={set("line2")}
              className={inputClass}
            />

            <div className="mt-sp3 grid gap-sp3 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="city">
                  {m.checkout.city}
                </label>
                <input
                  id="city"
                  required
                  autoComplete="address-level2"
                  value={values.city}
                  onChange={set("city")}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="postalCode">
                  {m.checkout.postalCode}
                </label>
                <input
                  id="postalCode"
                  required
                  autoComplete="postal-code"
                  value={values.postalCode}
                  onChange={set("postalCode")}
                  className={inputClass}
                />
              </div>
            </div>

            <label className={`mt-sp3 ${labelClass}`} htmlFor="country">
              {m.checkout.country}
            </label>
            <select
              id="country"
              value={country}
              onChange={(e) => setCountry(e.target.value as "US" | "CN")}
              className={inputClass}
            >
              <option value="US">{m.checkout.countryUS}</option>
              <option value="CN">{m.checkout.countryCN}</option>
            </select>

            <label className={`mt-sp3 ${labelClass}`} htmlFor="phone">
              {m.checkout.phone}
            </label>
            <input
              id="phone"
              autoComplete="tel"
              value={values.phone}
              onChange={set("phone")}
              className={inputClass}
            />

            <label className={`mt-sp3 ${labelClass}`} htmlFor="notes">
              {m.checkout.notes}
            </label>
            <textarea
              id="notes"
              rows={3}
              value={values.notes}
              onChange={set("notes")}
              className={`${inputClass} h-auto py-sp2`}
            />
          </section>

          {error ? (
            <p role="alert" className="rounded-btn border border-sold/50 px-sp3 py-sp2 text-body text-sold">
              {error}
            </p>
          ) : null}

          <div className="lg:hidden">
            <OrderSummary locale={locale} lines={lines} />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="h-12 w-full rounded-btn bg-accent text-body text-onAccent disabled:opacity-50"
          >
            {busy ? m.checkout.placing : m.checkout.placeOrder}
          </button>

          <p className="text-aux text-muted">{m.checkout.mockNotice}</p>

          <Link
            href={localePath(locale, "/cart")}
            className="block text-center text-aux text-muted underline hover:text-accent"
          >
            {m.checkout.backToBag}
          </Link>
        </form>

        <aside className="hidden lg:block">
          <OrderSummary locale={locale} lines={lines} />
        </aside>
      </div>
    </div>
  );
}

/** 右侧汇总：购物袋页、结账页、订单确认页共用同一套金额来源（1c-5） */
function OrderSummary({ locale, lines }: { locale: Locale; lines: ReturnType<typeof useCart>["lines"] }) {
  const mm = getMessages(locale);
  const t = cartTotals(lines);

  return (
    <div className="rounded-card border border-line bg-surface p-sp4">
      <h2 className="text-h2 text-ink">{mm.cart.summary}</h2>
      <ul className="mt-sp3 space-y-sp2">
        {lines.map((line) => (
          <li key={line.key} className="flex justify-between gap-sp3 text-aux">
            <span className="min-w-0 text-muted">
              {line.title} × {line.qty}
              {line.options.length ? (
                <span className="block text-[11px]">
                  {line.options.map((o) => `${o.name}: ${o.value}`).join(" · ")}
                </span>
              ) : null}
            </span>
            <Price usd={lineTotalUsd(line)} className="shrink-0 text-ink" />
          </li>
        ))}
      </ul>
      <dl className="mt-sp3 space-y-sp2 border-t border-line pt-sp3 text-body">
        <div className="flex justify-between">
          <dt className="text-muted">{mm.cart.subtotal}</dt>
          <dd>
            <Price usd={t.subtotalUsd} className="text-ink" />
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">{mm.cart.shipping}</dt>
          <dd>
            {t.shippingUsd === 0 ? (
              <span className="text-ink">{mm.cart.freeShipping}</span>
            ) : (
              <Price usd={t.shippingUsd} className="text-ink" />
            )}
          </dd>
        </div>
        <div className="flex justify-between border-t border-line pt-sp2">
          <dt className="text-ink">{mm.cart.total}</dt>
          <dd>
            <Price usd={t.totalUsd} className="text-h2 text-ink" />
          </dd>
        </div>
      </dl>
      <p className="mt-sp2 text-aux text-muted">{mm.cart.taxNote}</p>
    </div>
  );
}

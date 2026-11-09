"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { localePath, type Locale } from "@/i18n/config";
import imageLoader from "@/lib/image-loader";
import { getMessages } from "@/i18n/messages";
import { Price } from "@/components/currency/Price";
import {
  ORDER_HISTORY_KEY,
  readOrderHistory,
  recordOrder,
  type OrderCredential,
} from "@/lib/order-history";
import type { OrderStatus } from "@/lib/store/types";

/**
 * 「我的订单」列表（0.4.2）
 *
 * 静态壳 + 客户端状态：首帧不读 localStorage（服务端不知道访客有哪几单），
 * 所以本页仍然参与预渲染；hydration 后再拿本机凭据去 /api/orders 换最新状态。
 *
 * 四个标签按订单状态机归类：
 *   待付款 = created ｜ 待收货 = paid / fulfilled ｜ 已取消订单 = cancelled / refunded
 * 「全部订单」是同一批订单不过滤的视图 —— 所以一笔 created 订单会**同时**出现在
 * 「全部订单」和「待付款」里，四个标签不是互斥分类（0.4.5 在界面上写明这一点）。
 * 状态一律以服务端为准，本地不缓存任何状态——用户付完款回来点「刷新状态」即可更新。
 * 0.4.7：卡片为每一件商品渲染小图 + 右侧标题，数据来自 /api/orders 返回的 items 摘要，
 * 图片走构建期静态 WebP，破图退回宝石占位。
 * 0.4.8：小图与标题各自链到该商品详情页；slug 由服务端校验「仍在目录中」后才回传，
 * 为空时退化成纯文本，不制造死链。sharecode 由 SharecodeKeeper 自动补到这些站内链接上。
 */
type OrderItem = {
  /** 空字符串 = 商品已下架，不给详情页链接 */
  slug: string;
  title: string;
  imageUrl: string | null;
  qty: number;
  options: { name: string; value: string }[];
};

type Summary = {
  id: string;
  status: OrderStatus;
  createdAt: string;
  totalUsd: number;
  itemCount: number;
  /** 0.4.7：逐件商品，列表卡片为每件画小图 + 标题 */
  items: OrderItem[];
};

type TabKey = "all" | "unpaid" | "shipping" | "cancelled";

/**
 * 0.4.9：订单摘要的本机缓存。
 * 平台网关冷启动时会偶发 503（"workspace not ready"），/api/orders 也跟着失败；
 * 以前一失败就把列表清成空态，用户看到「待付款订单没了」。现在启动时先渲染缓存，
 * 失败保留缓存并重试，只有真正成功才覆盖。
 */
const SUMMARY_CACHE_KEY = "mm.orders.cache.v1";

function readCachedSummaries(): Summary[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SUMMARY_CACHE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Summary[]) : [];
  } catch {
    return [];
  }
}

function writeCachedSummaries(list: Summary[]) {
  try {
    window.localStorage.setItem(SUMMARY_CACHE_KEY, JSON.stringify(list));
  } catch {
    /* 隐私模式下缓存不可用，不影响本次会话 */
  }
}

const TAB_OF: Record<OrderStatus, TabKey> = {
  created: "unpaid",
  paid: "shipping",
  fulfilled: "shipping",
  cancelled: "cancelled",
  refunded: "cancelled",
};

const STATUS_LABEL: Record<
  OrderStatus,
  "statusCreated" | "statusPaid" | "statusFulfilled" | "statusCancelled" | "statusRefunded"
> = {
  created: "statusCreated",
  paid: "statusPaid",
  fulfilled: "statusFulfilled",
  cancelled: "statusCancelled",
  refunded: "statusRefunded",
};

/**
 * 从订单确认页 / 支付页链接里取出「订单号 + 口令」。
 * 只接受本机可解析的 URL；没有 token 的裸订单号一律拒绝——
 * 否则「知道订单号就能看到别人订单」这条口子会被重新打开。
 */
function parseOrderLink(input: string): { id: string; token: string } | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const u = new URL(text, window.location.origin);
    const token = u.searchParams.get("token");
    const parts = u.pathname.split("/").filter(Boolean);
    const id = parts[parts.length - 1] ?? "";
    if (!token || !/^[A-Za-z0-9_-]{3,40}$/.test(id)) return null;
    if (!/^[A-Za-z0-9._~-]{16,200}$/.test(token)) return null;
    return { id, token };
  } catch {
    return null;
  }
}

function Pill({ status, label }: { status: OrderStatus; label: string }) {
  const tone =
    status === "created"
      ? "bg-accentWeak text-ink"
      : status === "cancelled" || status === "refunded"
        ? "bg-bg text-muted"
        : "bg-surface text-ink";
  return (
    <span className={`shrink-0 rounded-btn border border-line px-sp2 py-sp1 text-aux ${tone}`}>
      {label}
    </span>
  );
}

/**
 * 0.4.7：订单卡片里的商品小图。
 * 直接指向构建期预生成的 128 档静态 WebP（56px 显示位，DPR2 也够清晰），
 * 不用 next/image 的 srcset —— 它会按 sizes 选到 240 档，而线上冷访那档图回源
 * 要几秒，用户会先看到一排空方块（飞入动画踩过同一个坑）。
 * 加载中与破图都退回宝石占位，加载完成再淡入。
 * 商品图是 4:5 竖构图、主体偏下，所以 img 上带了 objectPosition/scale：
 * 正方形里下移裁切并轻微放大，56px 也能看出是一件首饰而不是一片米色背景。
 */
/* eslint-disable @next/next/no-img-element */
function OrderItemThumb({ src, alt }: { src: string | null; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const url = src ? imageLoader({ src, width: 128 }) : "";
  const showImg = !!url && !broken;
  return (
    <span className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-btn border border-line bg-accentWeak">
      {showImg ? (
        <img
          src={url}
          alt={alt}
          width={56}
          height={56}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
          style={{ objectPosition: "center 62%", transform: "scale(1.25)" }}
          className={`h-full w-full object-cover transition-opacity duration-fade ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}
      {!showImg || !loaded ? (
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
            className="text-muted"
          >
            <path d="M12 2.5 20.5 9 12 21.5 3.5 9 12 2.5Z" />
            <path d="M3.5 9h17M12 2.5 8.8 9 12 21.5 15.2 9 12 2.5Z" />
          </svg>
        </span>
      ) : null}
    </span>
  );
}
/* eslint-enable @next/next/no-img-element */

export function OrdersView({ locale }: { locale: Locale }) {
  const m = getMessages(locale);
  const [ready, setReady] = useState(false);
  const [credentials, setCredentials] = useState<OrderCredential[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<TabKey>("all");
  const [linkInput, setLinkInput] = useState("");
  const [addMessage, setAddMessage] = useState<"ok" | "bad" | null>(null);

  /** 快速刷新 / 跨标签同步会连发多次 load，只有最后一次请求的结果允许落盘 */
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    const creds = readOrderHistory();
    setCredentials(creds);
    setReady(true);

    // 先垫上本机缓存：刷新那一瞬不会先闪一个「还没有订单」
    const cached = readCachedSummaries();
    if (cached.length) setSummaries((prev) => (prev.length ? prev : cached));

    if (creds.length === 0) {
      setFailed(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setFailed(false);
    let ok = false;
    // 网关冷启动 / 云数据库抖动时重试两次（0.7s、1.4s），仍失败就保留缓存并显示提示
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orders: creds.map(({ id: oid, token }) => ({ id: oid, token })),
            locale,
          }),
        });
        if (!res.ok) throw new Error("orders query failed");
        const data = (await res.json()) as { ok: boolean; orders: Summary[] };
        if (!data.ok) throw new Error("orders query failed");
        if (id !== reqId.current) return;
        setSummaries(data.orders);
        writeCachedSummaries(data.orders);
        ok = true;
        break;
      } catch {
        if (id !== reqId.current) return;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      }
    }
    if (id !== reqId.current) return;
    setFailed(!ok);
    setLoading(false);
  }, [locale]);

  /** 旧订单补登记：粘一条带 token 的确认页链接即可，服务端仍会逐条校验口令 */
  const addExisting = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseOrderLink(linkInput);
    if (!parsed) {
      setAddMessage("bad");
      return;
    }
    recordOrder(parsed.id, parsed.token);
    setLinkInput("");
    setAddMessage("ok");
    void load();
  };

  useEffect(() => {
    void load();
    // 另一个标签刚下了一单：清单跟着更新
    const onStorage = (e: StorageEvent) => {
      if (e.key === ORDER_HISTORY_KEY) void load();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [load]);

  const tabs: { key: TabKey; label: string }[] = useMemo(
    () => [
      { key: "all", label: m.orders.tabAll },
      { key: "unpaid", label: m.orders.tabUnpaid },
      { key: "shipping", label: m.orders.tabShipping },
      { key: "cancelled", label: m.orders.tabCancelled },
    ],
    [m],
  );

  const countOf = (key: TabKey) =>
    key === "all"
      ? summaries.length
      : summaries.filter((s) => TAB_OF[s.status] === key).length;

  const visible = useMemo(() => {
    const filtered = tab === "all" ? summaries : summaries.filter((s) => TAB_OF[s.status] === tab);
    return [...filtered].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [summaries, tab]);

  const tokenOf = (id: string) => credentials.find((c) => c.id === id)?.token ?? "";
  const missing = Math.max(0, credentials.length - summaries.length);
  const activeLabel = tabs.find((t) => t.key === tab)?.label ?? "";

  if (!ready) {
    return (
      <div className="shell max-w-[860px] py-sp6">
        <div className="h-8 w-40 animate-pulse rounded-btn bg-accentWeak" />
        <div className="mt-sp5 h-11 w-full animate-pulse rounded-btn bg-accentWeak" />
        <div className="mt-sp4 h-32 w-full animate-pulse rounded-card bg-accentWeak" />
      </div>
    );
  }

  return (
    <div className="shell max-w-[860px] py-sp5">
      <div className="flex flex-wrap items-end justify-between gap-sp3">
        <div>
          <h1 className="font-serif text-h1 text-ink">{m.orders.title}</h1>
          <p className="mt-sp2 text-body text-muted">{m.orders.subtitle}</p>
        </div>
        {credentials.length > 0 ? (
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="h-10 rounded-btn border border-line px-sp3 text-aux text-ink hover:bg-accentWeak disabled:opacity-50"
          >
            {loading ? m.orders.refreshing : m.orders.refresh}
          </button>
        ) : null}
      </div>

      {/* 390px 下四个标签（尤其英文）一行放不下：换行比横向滚动更容易被发现 */}
      <div
        role="group"
        aria-label={m.orders.title}
        className="mt-sp5 flex flex-wrap gap-sp2"
      >
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={active}
              onClick={() => setTab(t.key)}
              className={`flex h-10 shrink-0 items-center gap-sp1 rounded-btn border px-sp3 text-body transition-colors duration-fade ${
                active
                  ? "border-accent bg-accentWeak text-ink"
                  : "border-line text-muted hover:text-ink"
              }`}
            >
              {t.label}
              {!loading ? (
                <span className="text-aux tabular-nums text-muted">{countOf(t.key)}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* 0.4.5：把「全部」与状态页的包含关系写明。
          以前有人看到一笔待付款单在「全部订单」里，就以为它不会同时进「待付款」——
          实际上四个标签是同一批订单的不同视图，不是互斥分类。 */}
      <p className="mt-sp2 text-aux leading-relaxed text-muted">{m.orders.groupHint}</p>

      {failed ? (
        <p role="alert" className="mt-sp4 rounded-btn border border-sold/50 px-sp3 py-sp3 text-body text-sold">
          {m.orders.error}
        </p>
      ) : null}

      {loading && summaries.length === 0 ? (
        <p className="mt-sp5 text-body text-muted">{m.orders.loading}</p>
      ) : credentials.length === 0 && summaries.length === 0 ? (
        <div className="mt-sp6 rounded-card border border-line bg-surface px-sp4 py-sp7 text-center">
          <h2 className="font-serif text-h2 text-ink">{m.orders.emptyTitle}</h2>
          <p className="mx-auto mt-sp2 max-w-[46ch] text-body text-muted">{m.orders.emptyBody}</p>
          <Link
            href={localePath(locale, "/shop")}
            className="mt-sp5 inline-flex h-12 items-center justify-center rounded-btn bg-accent px-sp6 text-body text-onAccent hover:opacity-90"
          >
            {m.orders.browseAll}
          </Link>
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-sp6 rounded-card border border-line bg-surface px-sp4 py-sp7 text-center">
          <p className="text-body text-muted">{m.orders.emptyTab(activeLabel)}</p>
          <Link
            href={localePath(locale, "/shop")}
            className="mt-sp4 inline-flex h-11 items-center justify-center rounded-btn border border-accent px-sp5 text-body text-ink hover:bg-accentWeak"
          >
            {m.orders.browseAll}
          </Link>
        </div>
      ) : (
        <ul className="mt-sp4 space-y-sp3">
          {visible.map((s) => {
            const token = tokenOf(s.id);
            const href = (path: string) =>
              `${localePath(locale, path)}?token=${encodeURIComponent(token)}`;
            const placed = new Date(s.createdAt);
            const placedLabel = Number.isNaN(placed.getTime())
              ? s.createdAt
              : placed.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                });
            return (
              <li key={s.id} className="rounded-card border border-line bg-surface p-sp4">
                <div className="flex flex-wrap items-start justify-between gap-sp2">
                  <div className="min-w-0">
                    <p className="text-aux text-muted">{m.orders.number}</p>
                    <p className="text-body tabular-nums text-ink">{s.id}</p>
                  </div>
                  <Pill status={s.status} label={m.order[STATUS_LABEL[s.status]]} />
                </div>

                <dl className="mt-sp3 grid gap-sp2 text-aux sm:grid-cols-3">
                  <div>
                    <dt className="text-muted">{m.orders.placedOn}</dt>
                    <dd className="mt-sp1 text-ink">{placedLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{m.order.items}</dt>
                    <dd className="mt-sp1 text-ink">{m.orders.items(s.itemCount)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{m.orders.total}</dt>
                    <dd className="mt-sp1">
                      <Price usd={s.totalUsd} className="text-body text-ink" />
                    </dd>
                  </div>
                </dl>

                {/* 0.4.7 每件商品露脸；0.4.8 小图和标题各自链回该商品详情页 */}
                {s.items.length > 0 ? (
                  <ul className="mt-sp3 divide-y divide-line border-y border-line">
                    {s.items.map((item, i) => {
                      const name = item.title || "—";
                      // 服务端只在商品仍在目录中时回传 slug；为空就退化为纯文本，不留死链。
                      // 站内链接的 sharecode 由 SharecodeKeeper 统一补，不用在这里拼。
                      const productHref = item.slug
                        ? localePath(locale, `/products/${item.slug}`)
                        : "";
                      const thumb = <OrderItemThumb src={item.imageUrl} alt={name} />;
                      return (
                        <li
                          key={`${item.slug || item.title}-${item.imageUrl ?? "none"}-${i}`}
                          className="flex items-center gap-sp3 py-sp2"
                        >
                          {productHref ? (
                            // 小图链接只做鼠标点击区；标题链接才是键盘/读屏的主入口，
                            // 避免 Tab 重复经过同一个目标。
                            <Link
                              href={productHref}
                              aria-hidden="true"
                              tabIndex={-1}
                              className="shrink-0 rounded-btn transition-opacity duration-fade hover:opacity-80"
                            >
                              {thumb}
                            </Link>
                          ) : (
                            thumb
                          )}
                          <div className="min-w-0 flex-1">
                            {productHref ? (
                              <Link
                                href={productHref}
                                className="block line-clamp-2 text-body text-ink hover:text-accent hover:underline"
                              >
                                {name}
                              </Link>
                            ) : (
                              <p className="line-clamp-2 text-body text-ink">{name}</p>
                            )}
                            {item.options.length ? (
                              <p className="mt-sp1 line-clamp-1 text-aux text-muted">
                                {item.options.map((o) => `${o.name}: ${o.value}`).join(" · ")}
                              </p>
                            ) : null}
                          </div>
                          <span className="shrink-0 text-aux tabular-nums text-muted">
                            × {item.qty}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}

                <div className="mt-sp4 flex flex-wrap gap-sp2">
                  {s.status === "created" ? (
                    <Link
                      href={href(`/pay/${s.id}`)}
                      className="inline-flex h-11 items-center justify-center rounded-btn bg-accent px-sp5 text-body text-onAccent hover:opacity-90"
                    >
                      {m.orders.payNow}
                    </Link>
                  ) : null}
                  <Link
                    href={href(`/orders/${s.id}`)}
                    className="inline-flex h-11 items-center justify-center rounded-btn border border-accent px-sp5 text-body text-ink hover:bg-accentWeak"
                  >
                    {m.orders.viewOrder}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && !failed && missing > 0 ? (
        <p className="mt-sp4 text-aux text-muted">{m.orders.missingNote(missing)}</p>
      ) : null}

      {/* 升级前下的单：把确认页链接粘进来补登记，不用去翻邮件找订单号 */}
      <form
        onSubmit={addExisting}
        className="mt-sp6 rounded-card border border-line bg-surface p-sp4"
      >
        <h2 className="text-h2 text-ink">{m.orders.addExisting}</h2>
        <p className="mt-sp1 text-aux leading-relaxed text-muted">{m.orders.addExistingHint}</p>
        <div className="mt-sp3 flex flex-col gap-sp2 sm:flex-row">
          <label htmlFor="order-link" className="sr-only">
            {m.orders.addExistingPlaceholder}
          </label>
          <input
            id="order-link"
            type="text"
            value={linkInput}
            onChange={(e) => {
              setLinkInput(e.target.value);
              setAddMessage(null);
            }}
            placeholder={m.orders.addExistingPlaceholder}
            className="h-11 min-w-0 flex-1 rounded-btn border border-line bg-bg px-sp3 text-body text-ink placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            className="h-11 shrink-0 rounded-btn border border-accent px-sp5 text-body text-ink hover:bg-accentWeak"
          >
            {m.orders.addExistingButton}
          </button>
        </div>
        {addMessage ? (
          <p
            role="status"
            className={`mt-sp2 text-aux ${addMessage === "ok" ? "text-ink" : "text-sold"}`}
          >
            {addMessage === "ok" ? m.orders.addExistingOk : m.orders.addExistingBad}
          </p>
        ) : null}
      </form>

      <p className="mt-sp6 border-t border-line pt-sp4 text-aux leading-relaxed text-muted">
        {m.orders.privacyNote}
      </p>
    </div>
  );
}

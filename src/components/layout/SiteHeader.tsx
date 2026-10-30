"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { desktopNav, shopMenuNav } from "@/i18n/nav";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { BagIcon, SearchIcon } from "./icons";
import { LocaleSwitcher } from "@/components/i18n/LocaleSwitcher";
import { CurrencySwitcher } from "@/components/currency/CurrencySwitcher";

/**
 * 全局顶栏（01 §3）：移动端口径为「☰ + 品牌 + 🛒」，桌面端同一套结构横向展开。
 * 滚动态加淡边框（05 §2.1 骨架注释）；顶栏高 56px。
 *
 * 断点：< lg 收进抽屉，≥ lg 平铺。品类增至六类（Q-04）后若继续在 768–1024 平铺，
 * 品牌名 + 六个品类 + 三个工具会互相挤压，所以横向导航整体上移到 lg。
 */
export function SiteHeader({ locale }: { locale: Locale }) {
  const [scrolled, setScrolled] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const shopRef = useRef<HTMLDivElement>(null);
  const m = getMessages(locale);
  const lp = (href: string) => localePath(locale, href);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Shop 下拉：点击菜单外任意处 / 按 Esc / 选中某项后收起（2026-10-30）
  // 原先用原生 <details>：无 JS 也能展开，但浏览器只在点 summary 时切换，
  // 点面板外不会收起 —— 菜单会一直挂在页面上挡住内容。改成受控状态后
  // 这一条交互才成立（代价是依赖 JS，本站本就是客户端渲染，可接受）。
  useEffect(() => {
    if (!shopOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (shopRef.current && !shopRef.current.contains(e.target as Node)) setShopOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShopOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [shopOpen]);

  // 购物袋数量：m-1c 接入真实状态；本线恒为 0，故不渲染角标
  const cartCount = 0;

  return (
    <header
      className={`sticky top-0 z-40 bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur transition-[border-color] duration-fade ${
        scrolled ? "border-b border-line" : "border-b border-transparent"
      }`}
    >
      <div className="shell flex h-14 items-center gap-sp3">
        <div className="lg:hidden">
          <MobileNavDrawer locale={locale} />
        </div>

        <Link
          href={lp("/")}
          aria-label={`${SITE.brandName} — ${m.common.home}`}
          className="flex min-w-0 flex-1 items-center justify-center gap-sp2 text-ink lg:flex-none lg:justify-start"
        >
          {/* 顶栏保持纯文字标：加徽记后 390px 宽即使只在桌面显示也会挤压
              搜索/购物车，且 20px 下徽记细节糊成一团。图形识别交给 favicon 与页脚落款。
              0.3.3 起右上角常驻语言按钮，字标按宽度分三档收缩（字号靠 10/12/16 三级，
              **不用 truncate** —— 品牌名被省略号截断比缩字号更难看）：
              <380px 10px（"MORROW & MUSE" ≈ 92px）· 380–639px 12px · ≥sm 恢复 h2 16px */}
          <span className="whitespace-nowrap font-serif text-[12px] uppercase tracking-[0.08em] max-[379px]:text-[10px] max-[379px]:tracking-[0.05em] sm:text-h2 sm:tracking-[0.16em] lg:tracking-[0.2em]">
            {SITE.brandName}
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden lg:flex lg:flex-1 lg:items-center lg:gap-sp4">
          {/* Shop 下拉：六个品类 + 特殊集合。受控展开，点面板外 / Esc / 选中项后收起 */}
          <div className="relative" ref={shopRef}>
            <button
              type="button"
              aria-expanded={shopOpen}
              aria-haspopup="true"
              onClick={() => setShopOpen((v) => !v)}
              className="flex items-center gap-sp1 py-sp2 text-body text-ink hover:text-accent"
            >
              {m.nav.shop}
              <span
                aria-hidden="true"
                className={`text-aux text-muted transition-transform duration-fade ${
                  shopOpen ? "rotate-180" : ""
                }`}
              >
                ⌄
              </span>
            </button>
            {shopOpen ? (
              <div className="absolute left-0 top-full z-50 mt-sp1 w-[420px] rounded-card border border-line bg-bg p-sp4">
                <div className="grid grid-cols-2 gap-sp4">
                  {shopMenuNav(locale).map((group) => (
                    <div key={group.title}>
                      <p className="text-[11px] uppercase tracking-[0.16em] text-muted">
                        {group.title}
                      </p>
                      <ul className="mt-sp2 space-y-sp1">
                        {group.items.map((item) => (
                          <li key={item.href}>
                            <Link
                              href={lp(item.href)}
                              onClick={() => setShopOpen(false)}
                              className="block py-sp1 text-body text-ink hover:text-accent"
                            >
                              {item.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {desktopNav(locale).map((item) => (
            <Link
              key={item.href}
              href={lp(item.href)}
              className="text-body text-ink hover:text-accent"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-sp1 sm:gap-sp2 lg:ml-0">
          {/* 0.3.2：语言切换改成右上角单按钮，移动端也常显（手机上点一下就能换语言）
              0.3.3：<360px 时搜索图标让位（省 52px）—— 抽屉里保留搜索入口，
              这样 320px 宽也能给品牌名和语言按钮留出安全间距，不至于互相压字 */}
          <LocaleSwitcher current={locale} />
          <CurrencySwitcher className="hidden lg:flex" />
          <Link
            href={lp("/search")}
            aria-label={m.nav.search}
            className="hidden h-11 w-11 shrink-0 items-center justify-center text-ink min-[360px]:flex"
          >
            <SearchIcon className="h-5 w-5" />
          </Link>
          <Link
            href={lp("/cart")}
            aria-label={cartCount > 0 ? `${m.nav.cart} · ${cartCount}` : m.nav.cartAria}
            className="relative flex h-11 w-11 shrink-0 items-center justify-center text-ink"
          >
            <BagIcon className="h-5 w-5" />
            {cartCount > 0 ? (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-none text-onAccent">
                {cartCount}
              </span>
            ) : null}
          </Link>
        </div>
      </div>
    </header>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DESKTOP_NAV, CATEGORY_NAV, SITE } from "@/lib/site";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { BagIcon, SearchIcon } from "./icons";

/**
 * 全局顶栏（01 §3）：移动端口径为「☰ + 品牌 + 🛒」，桌面端同一套结构横向展开。
 * 滚动态加淡边框（05 §2.1 骨架注释）；顶栏高 56px。
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 购物车数量：m-1c 接入真实状态；本线恒为 0，故不渲染角标
  const cartCount = 0;

  return (
    <header
      className={`sticky top-0 z-40 bg-bg/90 backdrop-blur transition-[border-color] duration-fade ${
        scrolled ? "border-b border-line" : "border-b border-transparent"
      }`}
    >
      <div className="shell flex h-14 items-center gap-sp3">
        <div className="md:hidden">
          <MobileNavDrawer />
        </div>

        <Link
          href="/"
          className="flex-1 text-center font-serif text-h2 uppercase tracking-[0.2em] text-ink md:flex-none md:text-left"
        >
          {SITE.brandName}
        </Link>

        <nav aria-label="Primary" className="hidden md:flex md:flex-1 md:items-center md:gap-sp5">
          {DESKTOP_NAV.slice(0, 1).map((item) => (
            <Link key={item.href} href={item.href} className="text-body text-ink hover:text-accent">
              {item.label}
            </Link>
          ))}
          {CATEGORY_NAV.map((item) => (
            <Link key={item.href} href={item.href} className="text-body text-ink hover:text-accent">
              {item.label}
            </Link>
          ))}
          {DESKTOP_NAV.slice(1).map((item) => (
            <Link key={item.href} href={item.href} className="text-body text-ink hover:text-accent">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center md:ml-0">
          <Link
            href="/search"
            aria-label="Search"
            className="flex h-11 w-11 items-center justify-center text-ink"
          >
            <SearchIcon className="h-5 w-5" />
          </Link>
          <Link
            href="/cart"
            aria-label={cartCount > 0 ? `Cart, ${cartCount} items` : "Cart, empty"}
            className="relative flex h-11 w-11 items-center justify-center text-ink"
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

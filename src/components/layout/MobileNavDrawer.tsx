"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { drawerGroups } from "@/i18n/nav";
import { CloseIcon, MenuIcon, SearchIcon } from "./icons";
import { LocaleSwitcher } from "@/components/i18n/LocaleSwitcher";
import { CurrencySwitcher } from "@/components/currency/CurrencySwitcher";
import { FxNote } from "@/components/currency/CurrencySwitcher";

/**
 * 移动端汉堡抽屉（01 §3.1）：顶栏左侧 ☰，展开后分组导航。
 * 无障碍：Escape 关闭、打开时锁滚动、关闭时焦点回到触发按钮。
 *
 * 语言与币种切换在小屏上收进抽屉底部：顶栏只有 56px 高，塞两个切换器会把品牌名挤掉。
 */
export function MobileNavDrawer({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const m = getMessages(locale);
  const lp = (href: string) => localePath(locale, href);

  // 路由变化后自动关闭，避免抽屉盖住新页面
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={m.common.openMenu}
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
        onClick={() => setOpen(true)}
        className="-ml-2 flex h-11 w-11 items-center justify-center text-ink"
      >
        <MenuIcon className="h-6 w-6" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/30 fade-in"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            id="mobile-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={m.common.menu}
            className="absolute inset-y-0 left-0 w-[82%] max-w-[320px] overflow-y-auto bg-bg px-sp5 pb-sp6 pt-sp4 fade-in"
          >
            <div className="flex items-center justify-between">
              <span className="font-serif text-h2 uppercase tracking-[0.18em] text-muted">
                {m.common.menu}
              </span>
              <button
                type="button"
                aria-label={m.common.closeMenu}
                onClick={() => setOpen(false)}
                autoFocus
                className="-mr-2 flex h-11 w-11 items-center justify-center text-ink"
              >
                <CloseIcon className="h-6 w-6" />
              </button>
            </div>

            {/* 搜索入口（0.3.3）：<360px 顶栏不放搜索图标，改由抽屉承接，
                否则 320px 宽品牌名与语言按钮会互相压字 */}
            <Link
              href={lp("/search")}
              className="mt-sp4 flex h-11 items-center gap-sp2 rounded-btn border border-line bg-surface px-sp3 text-body text-muted"
            >
              <SearchIcon className="h-4 w-4 shrink-0" />
              {m.nav.search}
            </Link>

            <nav className="mt-sp5 space-y-sp6">
              {drawerGroups(locale).map((group) => (
                <div key={group.title}>
                  <p className="text-aux uppercase tracking-[0.16em] text-muted">{group.title}</p>
                  <ul className="mt-sp3 space-y-sp1">
                    {group.items.map((item) => (
                      <li key={item.href}>
                        <Link href={lp(item.href)} className="block py-sp2 text-body text-ink">
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>

            <div className="mt-sp6 space-y-sp3 border-t border-line pt-sp4">
              <div className="flex items-center justify-between gap-sp3">
                <LocaleSwitcher current={locale} />
                <CurrencySwitcher />
              </div>
              <FxNote className="text-[11px] leading-relaxed text-muted" />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

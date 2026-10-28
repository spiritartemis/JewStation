"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CATEGORY_NAV, STYLE_NAV, type NavItem } from "@/lib/site";
import { CloseIcon, MenuIcon } from "./icons";

type Group = { title: string; items: NavItem[] };

const GROUPS: Group[] = [
  { title: "Shop", items: [{ label: "All products", href: "/shop" }] },
  { title: "Category", items: CATEGORY_NAV },
  { title: "Style", items: STYLE_NAV },
  {
    title: "More",
    items: [
      { label: "One of a Kind", href: "/collections/one-of-a-kind" },
      { label: "About", href: "/about" },
      { label: "FAQ", href: "/faq" },
    ],
  },
];

/**
 * 移动端汉堡抽屉（01 §3.1）：顶栏左侧 ☰，展开后分组导航。
 * 无障碍：Escape 关闭、打开时锁滚动、关闭时焦点回到触发按钮。
 */
export function MobileNavDrawer() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

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
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
        onClick={() => setOpen(true)}
        className="-ml-2 flex h-11 w-11 items-center justify-center text-ink"
      >
        <MenuIcon className="h-6 w-6" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-ink/30 fade-in"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            id="mobile-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Site menu"
            className="absolute inset-y-0 left-0 w-[82%] max-w-[320px] overflow-y-auto bg-bg px-sp5 pb-sp6 pt-sp4 fade-in"
          >
            <div className="flex items-center justify-between">
              <span className="font-serif text-h2 uppercase tracking-[0.18em] text-muted">Menu</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                autoFocus
                className="-mr-2 flex h-11 w-11 items-center justify-center text-ink"
              >
                <CloseIcon className="h-6 w-6" />
              </button>
            </div>

            <nav className="mt-sp5 space-y-sp6">
              {GROUPS.map((group) => (
                <div key={group.title}>
                  <p className="text-aux uppercase tracking-[0.16em] text-muted">{group.title}</p>
                  <ul className="mt-sp3 space-y-sp1">
                    {group.items.map((item) => (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className="block py-sp2 text-body text-ink"
                        >
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}

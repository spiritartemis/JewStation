import { CATEGORY_TAGS, STYLE_TAGS, tagLabel } from "@/lib/tags";
import type { Locale } from "./config";
import { getMessages } from "./messages";

/** 导航项：label 已按语言解析，href 仍是「语言无关路径」（渲染时过 localePath） */
export type NavItem = { label: string; href: string };

/** 品类入口（Q-04：六品类，slug 即集合页路径） */
export function categoryNav(locale: Locale): NavItem[] {
  return CATEGORY_TAGS.map((t) => ({
    label: tagLabel(t.slug, locale),
    href: `/collections/${t.slug}`,
  }));
}

/** 抽屉里的风格入口（只放三个，全部风格见 STYLE_TAGS） */
export function styleNav(locale: Locale): NavItem[] {
  return STYLE_TAGS.slice(0, 3).map((t) => ({
    label: tagLabel(t.slug, locale),
    href: `/collections/${t.slug}`,
  }));
}

/**
 * 桌面主导航（01 §3.2）
 *
 * 品类从 4 个增到 6 个（Q-04）后，平铺 10 个一级项在 1024–1280 宽会换行，
 * 因此把品类收进 Shop 下拉；「后续再增补」也不会再挤爆一行。
 */
export function desktopNav(locale: Locale): NavItem[] {
  const m = getMessages(locale);
  return [
    { label: m.nav.oneOfAKind, href: "/collections/one-of-a-kind" },
    { label: m.nav.about, href: "/about" },
    { label: m.nav.faq, href: "/faq" },
  ];
}

/** Shop 下拉里的「全部」组：不重复品类，只放特殊集合 */
export function shopMenuNav(locale: Locale): { title: string; items: NavItem[] }[] {
  const m = getMessages(locale);
  return [
    {
      title: m.nav.category,
      items: categoryNav(locale),
    },
    {
      title: m.nav.shop,
      items: [
        { label: m.nav.allProducts, href: "/shop" },
        { label: m.nav.newArrivals, href: "/collections/new" },
        { label: m.nav.oneOfAKind, href: "/collections/one-of-a-kind" },
        { label: m.nav.restockable, href: "/collections/restockable" },
      ],
    },
  ];
}

/** 移动端抽屉分组（01 §3.1） */
export function drawerGroups(locale: Locale): { title: string; items: NavItem[] }[] {
  const m = getMessages(locale);
  return [
    {
      title: m.nav.shop,
      items: [
        { label: m.nav.allProducts, href: "/shop" },
        { label: m.nav.newArrivals, href: "/collections/new" },
      ],
    },
    { title: m.nav.category, items: categoryNav(locale) },
    { title: m.nav.style, items: styleNav(locale) },
    {
      title: m.nav.more,
      items: [
        { label: m.nav.oneOfAKind, href: "/collections/one-of-a-kind" },
        { label: m.nav.about, href: "/about" },
        { label: m.nav.faq, href: "/faq" },
      ],
    },
  ];
}

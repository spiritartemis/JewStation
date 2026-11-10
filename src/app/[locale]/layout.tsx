import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import { notFound } from "next/navigation";
import "../globals.css";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { CurrencyProvider } from "@/components/currency/CurrencyProvider";
import { CartProvider } from "@/components/cart/CartProvider";
import { ConsentProvider } from "@/components/privacy/ConsentProvider";
import { ScrollReturnTracker } from "@/components/common/ScrollReturnTracker";
import { SharecodeKeeper } from "@/components/common/SharecodeKeeper";
import { SITE } from "@/lib/site";
import { getUsdCnyRate } from "@/lib/currency";
import { DEFAULT_LOCALE, HTML_LANG, LOCALES, isLocale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/**
 * 字体：衬线标题 + 无衬线正文（05 §3.2）。品牌字体待 Q-15 确认，此处为建议值。
 * next/font 在构建期下载并自托管，运行时不请求外部域。
 */
const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  // Hero 的斜体大字要用真正的斜体字形，而不是浏览器合成的倾斜
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

/** 汇率每天 0 点失效（见 lib/currency.ts）；页面壳每小时重算一次足够 */
export const revalidate = 3600;

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

/** 站点级描述：用品牌与业务口径，不拿首页某个区块的说明句顶替 */
const SITE_DESCRIPTION: Record<string, string> = {
  en: "Small-batch handmade jewellery for the person you're becoming. One-of-a-kind pieces, made once — photographed as the exact one you'll receive.",
  zh: "小批量手作首饰，为正在成为的你。孤品只做一件，拍下的就是你收到的那一件。",
};

export async function generateMetadata({ params }: Omit<LayoutProps, "children">): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  return {
    title: {
      default:
        locale === "zh"
          ? `${SITE.brandName} ${SITE.brandNameZh} — ${SITE.taglineZh}`
          : `${SITE.brandName} — ${SITE.tagline}`,
      template: `%s | ${locale === "zh" ? SITE.brandNameZh : SITE.brandName}`,
    },
    description: SITE_DESCRIPTION[locale] ?? SITE_DESCRIPTION.en,
    applicationName: SITE.brandName,
  };
}

/**
 * 深色莫兰迪（Q-14 / Q-17，2026-10-30 定稿）：底色 #232120。
 * themeColor 必须跟着底色走 —— 它决定移动端浏览器地址栏 / 状态栏的底色，
 * 还停在浅色 #F4F1EB 时，深色页面顶部会顶出一条白带。
 * colorScheme 同步声明 dark，让原生控件（滚动条、表单、日期选择器）也用深色。
 */
export const viewport: Viewport = {
  themeColor: "#232120",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // 允许双指缩放（不设 maximumScale，避免无障碍问题）；
  // cover：刘海屏横向/添加到主屏时铺满，顶栏再用 env(safe-area-inset-*) 让出安全区
  viewportFit: "cover",
};

export default async function LocaleLayout({ children, params }: LayoutProps) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw;

  const m = getMessages(locale);
  // 汇率每日 0 点失效（见 lib/currency.ts），取不到时回退固定值并在切换器里标注
  const fx = await getUsdCnyRate();

  return (
    <html lang={HTML_LANG[locale]} className={`${serif.variable} ${sans.variable}`}>
      <body className="font-sans antialiased">
        <CurrencyProvider locale={locale} rate={fx.rate} fxSource={fx.source} fxAsOf={fx.asOf}>
          {/* Cookie 同意（0.5.0）：同意条与页脚偏好入口共用这一份状态。
              放在最外层，是因为它要在任何页面都能弹出，且早于业务组件读取同意状态 */}
          <ConsentProvider locale={locale}>
            {/* 购物袋状态（m-1c）：顶栏角标与袋子页共用同一份，跨页不丢 */}
            <CartProvider>
              <a
                href="#main"
                className="sr-only focus:not-sr-only focus:absolute focus:left-sp4 focus:top-sp4 focus:z-50 focus:rounded-btn focus:bg-surface focus:px-sp3 focus:py-sp2"
              >
                {m.common.skipToContent}
              </a>
              <SiteHeader locale={locale} />
              <main id="main">{children}</main>
              <SiteFooter locale={locale} />
              {/* 商品详情页的返回要回到原来那一屏（2026-11-03）：见组件内注释 */}
              <ScrollReturnTracker />
              {/* 分享网关要求 URL 常带 ?sharecode=，站内跳转/刷新/复制都要保住它（2026-11-05） */}
              <SharecodeKeeper />
            </CartProvider>
          </ConsentProvider>
        </CurrencyProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import { notFound } from "next/navigation";
import "../globals.css";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { CurrencyProvider } from "@/components/currency/CurrencyProvider";
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

export async function generateMetadata({ params }: Omit<LayoutProps, "children">): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const m = getMessages(locale);

  return {
    title: {
      default:
        locale === "zh"
          ? `${SITE.brandName} ${SITE.brandNameZh} — ${SITE.taglineZh}`
          : `${SITE.brandName} — ${SITE.tagline}`,
      template: `%s | ${locale === "zh" ? SITE.brandNameZh : SITE.brandName}`,
    },
    description: m.home.sections.oneOfAKindNote,
    applicationName: SITE.brandName,
  };
}

/** 浅色纸感底（Q-14 / Q-17）：不做深色模式，也不让浏览器自作主张反色 */
export const viewport: Viewport = {
  themeColor: "#F4F1EB",
  colorScheme: "light",
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
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-sp4 focus:top-sp4 focus:z-50 focus:rounded-btn focus:bg-surface focus:px-sp3 focus:py-sp2"
          >
            {m.common.skipToContent}
          </a>
          <SiteHeader locale={locale} />
          <main id="main">{children}</main>
          <SiteFooter locale={locale} />
        </CurrencyProvider>
      </body>
    </html>
  );
}

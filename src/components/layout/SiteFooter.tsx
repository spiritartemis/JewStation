import Link from "next/link";
import { SITE } from "@/lib/site";
import { BrandMark, BrandWordmark } from "@/components/brand/BrandMark";
import { FxNote } from "@/components/currency/CurrencySwitcher";
import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/**
 * 全站页脚（01 §3.3）：四组链接 + 订阅入口占位 + 汇率说明 + 版本与更新时间。
 * 订阅：V1.0 才实现，本线只占位且不外链（m-1b bootstrap §2 订阅入口留位）。
 */
export function SiteFooter({ locale }: { locale: Locale }) {
  const m = getMessages(locale);
  const lp = (href: string) => localePath(locale, href);
  const tagline = locale === "zh" ? SITE.taglineZh : SITE.tagline;

  return (
    <footer className="mt-sp6 border-t border-line bg-bg">
      <div className="shell py-sp6">
        {/* 品牌落款：徽记 + 字标 + Slogan。页脚是整页唯一以大尺度露出品牌的地方，
            刻意不给链接 —— 这是「落款」，不是导航入口 */}
        <div className="mb-sp6 flex items-center gap-sp3 border-b border-line pb-sp5 lg:gap-sp4">
          {/* 这套徽记按 256px 绘制：56–64px 是它「月缘铜带 + 四角星 + 散点」还能同时成立的区间，
              再小细节会互相挤压糊成一团（40px 左右最难看），所以宁可占大一点 */}
          <BrandMark className="h-16 w-16 shrink-0 text-ink lg:h-20 lg:w-20" />
          <div>
            <p className="font-serif text-h2 uppercase tracking-[0.18em] text-ink">
              <BrandWordmark />
            </p>
            <p className="mt-sp1 text-aux uppercase tracking-[0.22em] text-muted">{tagline}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-sp6 lg:grid-cols-4">
          {m.footer.groups.map((group) => (
            <div key={group.title}>
              <p className="text-aux uppercase tracking-[0.16em] text-muted">{group.title}</p>
              <ul className="mt-sp3 space-y-sp2">
                {group.items.map((item) => (
                  <li key={`${group.title}-${item.label}`}>
                    <Link
                      href={lp(item.href.replace("{email}", SITE.supportEmail))}
                      className="text-body text-ink hover:text-accent"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* 订阅入口占位：V1.0 实现，此处不可提交、不跳转（留位） */}
        <div className="mt-sp6 border-t border-line pt-sp5">
          <p className="text-aux uppercase tracking-[0.16em] text-muted">
            {m.footer.newsletterTitle}
          </p>
          <div className="mt-sp3 flex max-w-[420px] items-center gap-sp2">
            <input
              type="email"
              disabled
              placeholder={m.footer.emailPlaceholder}
              aria-disabled="true"
              className="h-11 flex-1 rounded-btn border border-line bg-surface px-sp3 text-body text-muted"
            />
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="h-11 rounded-btn border border-line px-sp4 text-body text-muted"
            >
              {m.footer.join}
            </button>
          </div>
          <p className="mt-sp2 text-aux text-muted">{m.footer.newsletterNote}</p>
        </div>

        <div className="mt-sp6 flex flex-col gap-sp2 border-t border-line pt-sp5 text-aux text-muted lg:flex-row lg:items-center lg:justify-between">
          <p>
            © {new Date().getFullYear()} {SITE.brandName}
            {locale === "zh" ? ` ${SITE.brandNameZh}` : ""}. {tagline}
          </p>
          {/* 版本号与更新时间：每次发布必须同步变更（见 src/lib/site.ts 顶部约定） */}
          <p>
            {m.footer.versionLabel} {SITE.version} · {m.footer.updatedLabel} {SITE.updatedAt}
          </p>
        </div>

        {/* 汇率口径（Q-05 / Q-08）：展示币种可切，结算价以结账页为准 */}
        <FxNote className="mt-sp3 text-[11px] leading-relaxed text-muted" />
      </div>
    </footer>
  );
}

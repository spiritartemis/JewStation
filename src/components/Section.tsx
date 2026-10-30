import Link from "next/link";
import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/**
 * 区块底色（莫兰迪色板）：plain = 不铺底；其余为对应色相的 Weak 面。
 * 用于给「手工孤品 / 流行款」等区块做可辨识的色彩分区（B-1.7）。
 */
export type SectionTone = "plain" | "mist" | "sage" | "clay" | "sand";

const TONE_BG: Record<SectionTone, string> = {
  plain: "",
  mist: "bg-mistWeak",
  sage: "bg-sageWeak",
  clay: "bg-clayWeak",
  sand: "bg-sandWeak",
};

/** 区块标题 + 可选「View all」（05 §2.1：区块标题 16/20，区块间距 32px） */
export function Section({
  title,
  href,
  locale,
  tone = "plain",
  description,
  children,
}: {
  title: string;
  href?: string;
  locale: Locale;
  tone?: SectionTone;
  /** 标题下的一句说明：用来解释区块规则（如「孤品只有一件」），不写促销话术 */
  description?: string;
  children: React.ReactNode;
}) {
  const m = getMessages(locale);

  return (
    <section className={`mt-sp6 ${TONE_BG[tone] ? `${TONE_BG[tone]} py-sp5` : ""}`}>
      <div className="shell flex items-baseline justify-between gap-sp4">
        <div>
          <h2 className="text-h2 text-ink">{title}</h2>
          {description ? (
            <p className="mt-sp1 max-w-[54ch] text-aux text-muted">{description}</p>
          ) : null}
        </div>
        {href ? (
          <Link
            href={localePath(locale, href)}
            className="shrink-0 text-aux text-muted hover:text-accent"
          >
            {m.common.viewAll}
          </Link>
        ) : null}
      </div>
      <div className="mt-sp3">{children}</div>
    </section>
  );
}

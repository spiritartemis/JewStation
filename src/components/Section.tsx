import Link from "next/link";

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
  tone = "plain",
  children,
}: {
  title: string;
  href?: string;
  tone?: SectionTone;
  children: React.ReactNode;
}) {
  return (
    <section className={`mt-sp6 ${TONE_BG[tone] ? `${TONE_BG[tone]} py-sp5` : ""}`}>
      <div className="shell flex items-baseline justify-between">
        <h2 className="text-h2 text-ink">{title}</h2>
        {href ? (
          <Link href={href} className="text-aux text-muted hover:text-accent">
            View all
          </Link>
        ) : null}
      </div>
      <div className="mt-sp3">{children}</div>
    </section>
  );
}

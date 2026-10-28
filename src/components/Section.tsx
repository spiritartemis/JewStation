import Link from "next/link";

/** 区块标题 + 可选「View all」（05 §2.1：区块标题 16/20，区块间距 32px） */
export function Section({
  title,
  href,
  children,
}: {
  title: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-sp6">
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

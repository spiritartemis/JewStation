import Link from "next/link";
import { Section } from "@/components/Section";
import { STYLE_TAGS } from "@/lib/tags";

/** 风格入口（B-2.2）：2 列网格，slug 与集合页同源 */
export function StyleGrid() {
  const styles = STYLE_TAGS.slice(0, 4);

  return (
    <Section title="Shop by style">
      <div className="shell grid grid-cols-2 gap-sp3">
        {styles.map((s) => (
          <Link
            key={s.slug}
            href={`/collections/${s.slug}`}
            className="flex h-24 items-center justify-center rounded-card border border-line bg-surface text-body text-ink hover:border-accent"
          >
            {s.label}
          </Link>
        ))}
      </div>
    </Section>
  );
}

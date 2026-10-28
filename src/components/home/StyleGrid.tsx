import Link from "next/link";
import { Section } from "@/components/Section";
import { STYLE_TAGS } from "@/lib/tags";

/**
 * 莫兰迪色相轮（docs/视觉规范-莫兰迪色板.md）
 * 类名写成字面量，Tailwind 才能扫到并生成对应工具类。
 */
const STYLE_TINTS = [
  { bg: "bg-mistWeak", hover: "hover:border-mist" },
  { bg: "bg-sageWeak", hover: "hover:border-sage" },
  { bg: "bg-clayWeak", hover: "hover:border-clay" },
  { bg: "bg-sandWeak", hover: "hover:border-sand" },
  { bg: "bg-mauveWeak", hover: "hover:border-mauve" },
];

/** 风格入口（B-2.2）：2 列网格，slug 与集合页同源 */
export function StyleGrid() {
  const styles = STYLE_TAGS.slice(0, 4);

  return (
    <Section title="Shop by style">
      <div className="shell grid grid-cols-2 gap-sp3">
        {styles.map((s, i) => {
          // 莫兰迪五色相循环：块面用 Weak，hover 时描边转对应色相主色
          const tint = STYLE_TINTS[i % STYLE_TINTS.length];
          return (
            <Link
              key={s.slug}
              href={`/collections/${s.slug}`}
              className={`flex h-24 items-center justify-center rounded-card border border-line font-serif text-body text-ink transition-colors duration-fade ${tint.bg} ${tint.hover}`}
            >
              {s.label}
            </Link>
          );
        })}
      </div>
    </Section>
  );
}

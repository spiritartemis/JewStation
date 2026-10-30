import Image from "next/image";
import Link from "next/link";
import { Section } from "@/components/Section";
import { STYLE_TAGS, tagLabel } from "@/lib/tags";
import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

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

/**
 * 风格入口配图（public/images，AI 生成的概念占位图，上线前替换为实拍）
 * key = 风格 slug，与 src/data/tags.json 同源。
 */
const STYLE_IMAGES: Record<string, string> = {
  minimal: "/images/style-minimal.jpg",
  vintage: "/images/style-vintage.jpg",
  statement: "/images/style-statement.jpg",
  nature: "/images/style-nature.jpg",
};

/** 风格入口（B-2.2）：2 列网格，slug 与集合页同源 */
export function StyleGrid({ locale }: { locale: Locale }) {
  const m = getMessages(locale);
  const styles = STYLE_TAGS.slice(0, 4);

  return (
    <Section title={m.home.sections.byStyle} locale={locale}>
      <div className="shell grid grid-cols-2 gap-sp3">
        {styles.map((s, i) => {
          // 莫兰迪五色相循环：块面用 Weak，hover 时描边转对应色相主色
          const tint = STYLE_TINTS[i % STYLE_TINTS.length];
          const image = STYLE_IMAGES[s.slug];

          return (
            <Link
              key={s.slug}
              href={localePath(locale, `/collections/${s.slug}`)}
              className={`group relative flex h-28 items-center justify-center overflow-hidden rounded-card border border-line transition-colors duration-fade md:h-32 ${tint.bg} ${tint.hover}`}
            >
              {image ? (
                <>
                  {/* 装饰性配图：文字标签已表达含义，alt 留空避免重复朗读 */}
                  <Image
                    src={image}
                    alt=""
                    fill
                    sizes="(max-width: 768px) 50vw, 300px"
                    className="object-cover"
                  />
                  {/* 薄雾层：只压掉一点图的锐度，让入口图仍有画面感（55% 会把图洗成灰板） */}
                  <span
                    aria-hidden
                    className="absolute inset-0 bg-bg/25 transition-opacity duration-fade group-hover:bg-bg/10"
                  />
                </>
              ) : null}
              {/* 标签做成半透明胶囊：底色固定中性黑（深色版 ink 是浅字色，不能当胶囊底），
                  不依赖图片明暗，任何配图上都读得清 */}
              <span className="relative rounded-btn bg-black/55 px-sp2 py-sp1 font-serif text-body text-white backdrop-blur-[2px]">
                {tagLabel(s.slug, locale)}
              </span>
            </Link>
          );
        })}
      </div>
    </Section>
  );
}

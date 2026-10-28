import Image from "next/image";
import Link from "next/link";
import { HOME_HERO } from "@/content/site-content";

/**
 * 首页 Hero（B-2.2 第一区块）
 *
 * 文案读内容源（B-2.8）。主图属站长素材（Q-16 / Q-53）：
 * 未提供时渲染占位块并明确标注，**不拿 AI 生成图冒充实拍素材**（m-1b bootstrap §5）。
 * 图片就位后只需在 HOME_HERO.imageUrl 填入路径，无需改本组件。
 */
export function Hero() {
  const hasImage = HOME_HERO.imageUrl.length > 0;

  return (
    <section aria-label="Featured" className="relative">
      {/* 底为莫兰迪渐变（雾青 → 沙米）：实拍主图到位后由 <Image> 覆盖 */}
      <div className="relative flex aspect-[4/5] w-full items-center justify-center bg-hero md:aspect-[16/9]">
        {/* 极淡的柔光层，只做层次，不抢商品图（05 §1 图片优先） */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/35 via-transparent to-transparent"
        />
        {hasImage ? (
          <Image
            src={HOME_HERO.imageUrl}
            alt={HOME_HERO.imageAlt}
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
        ) : (
          <span className="text-aux uppercase tracking-[0.16em] text-muted">
            {HOME_HERO.imagePendingNote}
          </span>
        )}
      </div>

      <div className="shell pointer-events-none absolute inset-x-0 bottom-sp5">
        {/* 首页唯一的 h1：区块标题由 Section 输出 h2，标题层级不断层 */}
        <h1 className="max-w-[24ch] font-serif text-h1 text-ink">{HOME_HERO.headline}</h1>
        <p className="mt-sp2 max-w-[32ch] text-aux text-muted">{HOME_HERO.subline}</p>
        <Link
          href={HOME_HERO.ctaHref}
          className="pointer-events-auto mt-sp3 inline-flex h-12 items-center justify-center rounded-btn bg-accent px-sp5 text-body text-white transition-opacity duration-fade hover:opacity-90"
        >
          {HOME_HERO.ctaLabel}
        </Link>
      </div>
    </section>
  );
}

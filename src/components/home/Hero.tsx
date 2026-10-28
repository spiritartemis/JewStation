import Image from "next/image";
import Link from "next/link";
import { HOME_HERO } from "@/content/site-content";

/**
 * 首页 Hero（B-2.2 第一区块）
 *
 * 文案读内容源（B-2.8）。主图属站长素材（Q-16 / Q-53）：
 * 当前 imageUrl 指向 public/images/hero-home.jpg，为 **AI 生成的概念占位图**，
 * 上线前需替换为真实品牌视觉或实拍场景图（替换文件即可，无需改本组件）。
 */
export function Hero() {
  const hasImage = HOME_HERO.imageUrl.length > 0;

  return (
    <section aria-label="Featured" className="relative">
      {/* 底为深色莫兰迪渐变：图片未加载 / 缺失时的兜底视觉 */}
      <div className="relative flex aspect-[4/5] w-full items-center justify-center bg-hero md:aspect-[16/9]">
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
        {/* 底部压暗：只覆盖下 40%，保证叠字在任何图上仍可读（05 §1 图片优先） */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-bg/90 via-bg/45 to-transparent"
        />
      </div>

      <div className="shell pointer-events-none absolute inset-x-0 bottom-sp5">
        {/* 首页唯一的 h1：区块标题由 Section 输出 h2，标题层级不断层 */}
        <h1 className="max-w-[24ch] font-serif text-h1 text-ink">{HOME_HERO.headline}</h1>
        <p className="mt-sp2 max-w-[32ch] text-aux text-muted">{HOME_HERO.subline}</p>
        <Link
          href={HOME_HERO.ctaHref}
          className="pointer-events-auto mt-sp3 inline-flex h-12 items-center justify-center rounded-btn bg-accent px-sp5 text-body text-onAccent transition-opacity duration-fade hover:opacity-90"
        >
          {HOME_HERO.ctaLabel}
        </Link>
      </div>
    </section>
  );
}

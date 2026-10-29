import Image from "next/image";
import Link from "next/link";
import { HOME_HERO } from "@/content/site-content";

/**
 * 首页 Hero（B-2.2 第一区块）
 *
 * 排版：编辑感双行大字（正体 + 斜体陶粉），配眉标小字与细引线，压在图片底部。
 * 字号用 text-display（clamp：375px ≈ 36px → 桌面 ≈ 68px），窄屏不溢出。
 * 动效只允许淡入 + 极小位移，整体控制在 200ms 内（05 §3.4）。
 *
 * 文案读内容源（B-2.8）。主图属站长素材（Q-16 / Q-53）：
 * 当前 imageUrl 指向 public/images/hero-home.jpg，为 **AI 生成的概念占位图**，
 * 上线前需替换为真实品牌视觉或实拍场景图（换 public/images 下的文件即可，无需改本组件）。
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
        {/* 底部压暗：大字压在图上，压暗只覆盖下 60%，不破坏图片整体（05 §1 图片优先） */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-bg/95 via-bg/55 to-transparent"
        />
      </div>

      <div className="shell pointer-events-none absolute inset-x-0 bottom-sp5 md:bottom-sp6">
        <div className="max-w-[46ch]">
          {/* 眉标：细引线 + 全大写小字，交代品牌身份 */}
          <p className="flex items-center gap-sp3 text-aux uppercase tracking-[0.22em] text-muted fade-in">
            <span aria-hidden className="h-px w-8 shrink-0 bg-line md:w-12" />
            {HOME_HERO.eyebrow}
          </p>

          {/* 首页唯一的 h1：双行展示级大字，第二行斜体 + 陶粉 */}
          <h1
            className="mt-sp3 max-w-[16ch] font-serif text-display text-ink fade-in"
            style={{ animationDelay: "40ms" }}
          >
            {HOME_HERO.headline}
            <span className="block italic text-clay">{HOME_HERO.headlineAccent}</span>
          </h1>

          <p
            className="mt-sp4 max-w-[34ch] text-body text-muted fade-in"
            style={{ animationDelay: "80ms" }}
          >
            {HOME_HERO.subline}
          </p>

          <Link
            href={HOME_HERO.ctaHref}
            className="pointer-events-auto mt-sp4 inline-flex h-12 items-center justify-center rounded-btn bg-accent px-sp5 text-body text-onAccent transition-opacity duration-fade hover:opacity-90 fade-in"
            style={{ animationDelay: "120ms" }}
          >
            {HOME_HERO.ctaLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}

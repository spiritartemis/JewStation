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
      {/*
        高度按视口算，不用固定宽高比：16:9 在 1440 宽屏上会到 810px，
        加上顶栏就把底部大字推到首屏之外（只露出字头）。
        svh 取「可视高度」而非布局高度，移动端浏览器地址栏收起/展开都不会跳动。
        max-h 兜住超高大屏，min-h 保证窄高屏上图文不挤压。
      */}
      <div className="relative flex h-[72svh] max-h-[560px] min-h-[420px] w-full items-center justify-center overflow-hidden bg-hero md:h-[76svh] md:max-h-[660px] md:min-h-[460px]">
        {hasImage ? (
          <Image
            src={HOME_HERO.imageUrl}
            alt={HOME_HERO.imageAlt}
            fill
            priority
            sizes="100vw"
            // 取景：主图是暖白石膏面上的首饰特写，首饰簇在画面 62%/48% 处。
            // 浅色版把首饰留在右侧、文案落在左侧留白；移动端竖裁把首饰簇推到 62%，上方留白给眉标、下方压字
            // 推镜（kenburns）：只缩放 7.5%，原点压在首饰簇上，放大时首饰不漂移；reduce motion 时静止
            className="animate-kenburns origin-[62%_48%] object-cover object-[62%_46%] will-change-transform motion-reduce:animate-none md:object-[54%_50%]"
          />
        ) : (
          <span className="text-aux uppercase tracking-[0.16em] text-muted">
            {HOME_HERO.imagePendingNote}
          </span>
        )}
        {/* 底部提亮：大字压在图上，用页面底色把下 60% 拉回米白，让文字落在干净面上（05 §1 图片优先） */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-bg via-bg/60 to-transparent"
        />
        {/* 左侧横向提亮：文字栏固定压左边，左侧加一层纸白雾，换任何主图都能读（不遮首饰一侧） */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-full bg-gradient-to-r from-bg/90 via-bg/35 to-transparent md:w-3/5"
        />
      </div>

      <div className="shell pointer-events-none absolute inset-x-0 bottom-sp5 md:bottom-sp6">
        <div className="max-w-[46ch]">
          {/* 眉标：细引线 + 全大写小字，交代品牌身份。
              浅色版压在照片中段偏亮的纸面上，用 ink/70 而非 muted，保证叠在窗影上也读得清 */}
          <p className="flex items-center gap-sp3 text-aux uppercase tracking-[0.22em] text-ink/70 fade-in">
            <span aria-hidden className="h-px w-8 shrink-0 bg-ink/35 md:w-12" />
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

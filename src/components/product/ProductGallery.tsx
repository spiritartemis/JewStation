"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import type { ProductImage } from "@/lib/types";
import type { Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { ArrowLeftIcon } from "@/components/layout/icons";

/** 滑动判定的最小横向位移，低于此值按误触处理（点按会有几像素抖动） */
const SWIPE_MIN_PX = 40;
/** 横向位移还得明显大于纵向，否则是纵向滚动带出来的斜向滑动 */
const SWIPE_RATIO = 1.2;

/**
 * 商品图区（B-2.6；0.3.13 补多图翻页）
 * 首图 priority（LCP），其余按需加载；有宽高故不产生 CLS（05 §5）。
 * 无实拍图时只渲染占位块，绝不用 AI 图冒充商品图。
 *
 * 翻页三通道：缩略图点击、大图左右箭头、触摸滑动（移动端主力）。
 * 方向键也接上了，焦点在箭头按钮上时可直接切。
 * 首尾循环：实拍图通常就 3 张，循环比「到头禁用」少一次点空。
 */
export function ProductGallery({
  images,
  title,
  locale,
}: {
  images: ProductImage[];
  title: string;
  locale: Locale;
}) {
  const [index, setIndex] = useState(0);
  const m = getMessages(locale);
  // 触点起点：touchstart 只记一次，touchend 比差值
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  // hooks 不能放在 early return 之后，故这几个派生值先算
  const sorted = [...images].sort((a, b) => a.order - b.order);
  const total = sorted.length;

  const step = useCallback(
    (delta: number) => {
      setIndex((prev) => (total === 0 ? 0 : (prev + delta + total) % total));
    },
    [total],
  );

  if (images.length === 0) {
    return (
      <div className="flex aspect-[4/5] w-full items-center justify-center bg-accentWeak">
        <span className="text-aux uppercase tracking-[0.16em] text-muted">
          {m.product.photoPending}
        </span>
      </div>
    );
  }

  const current = sorted[Math.min(index, total - 1)];
  // 只有首图是 LCP：给切换后的图也加 priority 会让每次点缩略图都插一条 preload，
  // 首屏之外的那几张反而挤占带宽
  const isFirstShown = index === 0;
  const hasMany = total > 1;

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    const t = e.changedTouches[0];
    if (!start || !t) return;

    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX) return;
    if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;

    // 手指往左划（dx < 0）＝看下一张，跟原生图库一致
    step(dx < 0 ? 1 : -1);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!hasMany) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    }
  };

  const arrowClass =
    "absolute top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-line/70 bg-bg/70 text-ink backdrop-blur-sm transition-colors hover:bg-bg/90 sm:h-10 sm:w-10";

  return (
    <div onKeyDown={onKeyDown} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* touch-pan-y：把横向手势留给自己，纵向滚动仍交给浏览器，
          否则移动端横滑会被当成「侧滑返回」 */}
      <div className="relative touch-pan-y overflow-hidden rounded-img bg-accentWeak">
        <Image
          key={current.url}
          src={current.url}
          alt={current.alt || title}
          width={current.width}
          height={current.height}
          sizes="(max-width: 768px) 100vw, 600px"
          priority={isFirstShown}
          loading={isFirstShown ? undefined : "lazy"}
          /* 切图时淡入，避免硬切；prefers-reduced-motion 下该动画被关掉（globals.css） */
          className="fade-in h-auto w-full object-cover"
          /* 桌面端原生长按拖图会开拖放，把点击和滑动都吃掉 */
          draggable={false}
        />

        {hasMany ? (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label={m.product.prevImage}
              className={`${arrowClass} left-sp2`}
            >
              <ArrowLeftIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label={m.product.nextImage}
              className={`${arrowClass} right-sp2`}
            >
              <ArrowLeftIcon className="h-4 w-4 rotate-180" />
            </button>

            {/* 计数放右下：不压主体，也交代了「还有几张」 */}
            <span
              className="pointer-events-none absolute bottom-sp2 right-sp2 rounded-full bg-bg/70 px-sp2 py-[2px] text-aux tabular-nums text-ink backdrop-blur-sm"
              aria-hidden="true"
            >
              {index + 1} / {total}
            </span>
            {/* 读屏走播报，视觉计数对它隐藏，免得重复念一遍 */}
            <span className="sr-only" aria-live="polite">
              {m.product.imageCounter(index + 1, total)}
            </span>
          </>
        ) : null}
      </div>

      {hasMany ? (
        <div className="mt-sp3 flex gap-sp2 overflow-x-auto pb-sp1">
          {sorted.map((img, i) => (
            <button
              key={img.url}
              type="button"
              onClick={() => setIndex(i)}
              // 缩略图序号对读屏没有意义，直接说"看第几张图"
              aria-label={locale === "zh" ? `查看第 ${i + 1} 张图` : `Show image ${i + 1}`}
              aria-current={i === index}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-img border ${
                i === index ? "border-accent" : "border-line"
              }`}
            >
              <Image
                src={img.url}
                alt=""
                width={img.width}
                height={img.height}
                sizes="64px"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

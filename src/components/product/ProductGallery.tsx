"use client";

import { useState } from "react";
import Image from "next/image";
import type { ProductImage } from "@/lib/types";

/**
 * 商品图区（B-2.6）
 * 首图 priority（LCP），其余按需加载；有宽高故不产生 CLS（05 §5）。
 * 无实拍图时只渲染占位块，绝不用 AI 图冒充商品图。
 */
export function ProductGallery({ images, title }: { images: ProductImage[]; title: string }) {
  const [index, setIndex] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex aspect-[4/5] w-full items-center justify-center bg-accentWeak">
        <span className="text-aux uppercase tracking-[0.16em] text-muted">Photo pending</span>
      </div>
    );
  }

  const sorted = [...images].sort((a, b) => a.order - b.order);
  const current = sorted[Math.min(index, sorted.length - 1)];

  return (
    <div>
      <div className="relative overflow-hidden rounded-img bg-accentWeak">
        <Image
          key={current.url}
          src={current.url}
          alt={current.alt || title}
          width={current.width}
          height={current.height}
          sizes="(max-width: 768px) 100vw, 600px"
          priority
          className="h-auto w-full object-cover"
        />
      </div>

      {sorted.length > 1 ? (
        <div className="mt-sp3 flex gap-sp2 overflow-x-auto pb-sp1">
          {sorted.map((img, i) => (
            <button
              key={img.url}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show image ${i + 1}`}
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

import type { SVGProps } from "react";

/**
 * 品牌图形标（Morrow & Muse 星月徽记）—— 内联 SVG，不额外请求。
 *
 * 为什么内联而不用 public/brand 里的 .svg 文件：
 *   徽记的负形（星形、轨道线）要和所在区块的底色同色才成立，
 *   外部文件只能写死一个颜色，放在不同底色上会出现「白色补丁」。
 *   内联后负形用 var(--c-bg)，跟随页面底色；墨色用 currentColor，跟随文字色。
 *
 * 颜色语义：墨色 = 所在处文字色；负形 = 页面底色；铜色星点 = 品牌铜（不随主题变）。
 */
export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 256 256" aria-hidden="true" focusable="false" {...props}>
      {/* 外圈：开口的镶口，兼作 M 的起笔 */}
      <path
        d="M77 164 C61 133 69 95 96 70 C120 48 154 43 183 58 C159 56 136 64 119 81 C96 104 91 139 108 168 C125 197 158 211 190 202 C165 223 128 225 99 207 C89 200 82 183 77 164Z"
        fill="currentColor"
      />
      {/* 铜色内弧：月的内缘 */}
      <path
        d="M89 163 C78 137 84 106 105 85 C123 67 148 60 171 64 C151 67 134 77 122 92 C104 114 102 144 116 167 C130 190 157 202 183 197 C161 210 134 207 112 194 C101 187 94 176 89 163Z"
        fill="var(--c-copper)"
      />
      {/* 四角星：负形（底色） */}
      <path
        d="M161 70 C165 85 169 89 184 92 C169 95 165 99 161 114 C158 99 154 95 139 92 C154 89 158 85 161 70Z"
        fill="var(--c-bg)"
      />
      {/* M 的折返笔画 */}
      <path d="M115 146 C126 128 136 119 146 116 C139 135 139 149 146 165 C136 160 126 154 115 146Z" fill="currentColor" />
      <path
        d="M119 146 C129 139 137 132 144 122 M119 146 C130 151 138 158 144 168"
        fill="none"
        stroke="var(--c-bg)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {/* 三颗散点：珍珠 */}
      <circle cx="199" cy="113" r="3" fill="var(--c-copper)" />
      <circle cx="211" cy="135" r="2" fill="currentColor" />
      <circle cx="196" cy="153" r="2.5" fill="var(--c-copper)" />
    </svg>
  );
}

/**
 * 品牌字标：文字用站点衬线（Cormorant Garamond）排，不用 SVG 里的 `<text>`。
 *
 * 为什么不直接把 logo.svg 里的文字搬进来：那份 SVG 依赖 Bodoni 72 / Didot 等本机字体，
 * 换台机器字形就变；而站内已有 Cormorant，字标与正文同源才不会「logo 一个字体、页面另一个字体」。
 * 「&」用斜体 + 铜色，与徽记的铜色呼应 —— 这是字标的设计点，不是装饰。
 */
export function BrandWordmark({
  className = "",
  accentClassName = "",
}: {
  className?: string;
  accentClassName?: string;
}) {
  return (
    <span className={className}>
      Morrow <span className={`italic text-copper ${accentClassName}`}>&amp;</span> Muse
    </span>
  );
}

import type { Config } from "tailwindcss";

/**
 * Token 来源：docs/spec/05-低保真结构与视觉规范.md §3
 * 色系：莫兰迪（低饱和 + 灰调），**浅色版 / 暖纸调**（light Morandi），色板明细见 docs/视觉规范-莫兰迪色板.md
 * 强调色为暂定值，待站长提供 Logo/视觉参考后校准（Q-14）。
 *
 * 对比度：ink #2C2D2A 在 bg #F4F1EB 上 ≈ 12:1；muted #6F6C65 ≈ 4.7:1（正文级）；
 * accent #56745F 上放 onAccent #FFFFFF ≈ 5.2:1。浅色版不再需要「深底亮字」那套反色规则。
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 中性基底（暖纸调：米白 + 灰褐，莫兰迪画作的底子色）
        bg: "#F4F1EB",
        surface: "#FBFAF7",
        band: "#ECE7DF",
        ink: "#2C2D2A",
        muted: "#6F6C65",
        line: "#DCD6CB",
        // 主强调：莫兰迪深鼠尾草绿（CTA、选中态、角标）—— 在浅底上够沉，压得住米白
        accent: "#56745F",
        accentWeak: "#DFE8E1",
        /** 强调色表面上的文字色（深绿强调 + 白字，≈ 5.2:1） */
        onAccent: "#FFFFFF",
        sold: "#67645D",
        warn: "#B5794F",
        // 莫兰迪五色相（浅色版：块面用浅调 Weak，描边/文字用同色系深调主色）
        mist: "#6B8497",
        mistWeak: "#E3EAEF",
        sage: "#6F8A6D",
        sageWeak: "#E5ECE0",
        clay: "#A9765F",
        clayWeak: "#F1E3DB",
        sand: "#9A8659",
        sandWeak: "#F0E8D8",
        mauve: "#8B7595",
        mauveWeak: "#EAE2ED",
        /** 品牌铜：仅供品牌资产（徽记月缘/散点、字标「&」），不用于 UI 语义 */
        copper: "#B68E64",
      },
      backgroundImage: {
        // Hero 底：暖纸莫兰迪渐变（图未加载 / 图片缺失时的兜底视觉）
        hero: "linear-gradient(155deg, #F6F3ED 0%, #EFEAE1 48%, #E4DED3 100%)",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      fontSize: {
        /**
         * Hero 展示级字号：随视口缩放（375px ≈ 36px → 桌面 ≈ 68px），行高压到 1.04 做编辑感排版。
         * 仍遵循「移动优先 + 不溢出」：用 vw 而非固定值，窄屏不会撑破。
         */
        display: [
          "clamp(2.25rem, 9vw, 4.25rem)",
          { lineHeight: "1.04", letterSpacing: "-0.015em" },
        ],
        // 移动端口径：H1 20/28 · H2 16/20 · 正文 14/22 · 辅助 12/18（05 §3.2）
        h1: ["1.25rem", { lineHeight: "1.75rem" }],
        h2: ["1rem", { lineHeight: "1.25rem" }],
        body: ["0.875rem", { lineHeight: "1.375rem" }],
        aux: ["0.75rem", { lineHeight: "1.125rem" }],
      },
      spacing: {
        sp1: "4px",
        sp2: "8px",
        sp3: "12px",
        sp4: "16px",
        sp5: "24px",
        sp6: "32px",
      },
      borderRadius: {
        img: "4px",
        card: "8px",
        btn: "6px",
      },
      transitionDuration: {
        // 克制动效：淡入 120ms（05 §3.4）
        fade: "120ms",
      },
      keyframes: {
        /**
         * Hero 缓慢推镜（Ken Burns）：18s 单向、alternate 来回，整周期 36s。
         * 幅度 7.5%（1.0 → 1.075）—— 再小看不出在动，再大就晕；只动 transform，不触发布局。
         */
        kenburns: {
          "0%": { transform: "scale(1.0) translate3d(0, 0, 0)" },
          "100%": { transform: "scale(1.075) translate3d(-1.2%, -0.9%, 0)" },
        },
      },
      animation: {
        kenburns: "kenburns 18s ease-in-out infinite alternate",
      },
      maxWidth: {
        shell: "1200px",
      },
    },
  },
  plugins: [],
};

export default config;

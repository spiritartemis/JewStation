import type { Config } from "tailwindcss";

/**
 * Token 来源：docs/spec/05-低保真结构与视觉规范.md §3
 * 色系：莫兰迪（低饱和 + 灰调），**深色版**（dark Morandi），色板明细见 docs/视觉规范-莫兰迪色板.md
 * 强调色为暂定值，待站长提供 Logo/视觉参考后校准（Q-14）。
 *
 * 对比度：ink #E9E4DC / accent #A9B9AD 在深色底（bg、Weak 系列）上均 ≥ 4.5:1；
 * accent 上的文字统一用 onAccent #22201D（≈ 7:1），不要用白色。
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 中性基底（冷石墨版：去掉暖褐，读起来更现代、更年轻）
        bg: "#1C1E20",
        surface: "#24272B",
        band: "#292D31",
        ink: "#EFEBE4",
        muted: "#A3A6A4",
        line: "#373C40",
        // 主强调：莫兰迪薄荷（CTA、选中态、角标）—— 比上一版更亮更冷，面向 20–25 岁
        accent: "#A8CDB7",
        accentWeak: "#2A3630",
        /** 强调色表面上的文字色（深底 + 亮强调，文字必须走深色） */
        onAccent: "#17201B",
        sold: "#8B8F8D",
        warn: "#D8A38C",
        // 莫兰迪五色相（深色版：块面用暗调 Weak，描边/点缀用亮调主色）
        mist: "#A6C4D8",
        mistWeak: "#222D36",
        sage: "#B3D2A7",
        sageWeak: "#262F28",
        clay: "#DFB3A2",
        clayWeak: "#332827",
        sand: "#E1D0B3",
        sandWeak: "#332F27",
        mauve: "#C6AFD0",
        mauveWeak: "#2C2632",
      },
      backgroundImage: {
        // Hero 底：冷石墨莫兰迪渐变（图未加载 / 图片缺失时的兜底视觉）
        hero: "linear-gradient(155deg, #2B3234 0%, #2F2C29 48%, #1B1D1F 100%)",
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

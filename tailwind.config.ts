import type { Config } from "tailwindcss";

/**
 * Token 来源：docs/spec/05-低保真结构与视觉规范.md §3
 * 色系：莫兰迪（低饱和 + 灰调），**深色版 / 暖褐黑调**（dark Morandi），色板明细见 docs/视觉规范-莫兰迪色板.md
 * 强调色为暂定值，待站长提供 Logo/视觉参考后校准（Q-14）。
 *
 * 2026-10-30 第四次调色：按站长要求由暖纸浅色版改回**深色莫兰迪**。
 * 底色取暖褐黑 #232120（不是纯黑，保留莫兰迪的灰调），强调色取雾鼠尾草绿 #8FA891
 * —— 深底上强调色必须比浅底那档更亮才立得住，否则整块沉进背景。
 *
 * 对比度（深底）：ink #EDE9E2 在 bg #232120 上 ≈ 11:1；muted #A9A29A ≈ 6:1（正文级）；
 * accent #8FA891 上放 onAccent #1E1D1C 深字 ≈ 6:1（深底不可用白字，白字仅 ≈ 2.3:1）。
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 中性基底（暖褐黑：莫兰迪画作的深底子色，不是纯黑）
        bg: "#232120",
        surface: "#2B2A28",
        band: "#1B1A19",
        ink: "#EDE9E2",
        muted: "#A9A29A",
        line: "#3A3735",
        // 主强调：莫兰迪鼠尾草绿·亮调（深底版）—— 深字压在其上 ≈ 6:1
        accent: "#8FA891",
        accentWeak: "#2E3A32",
        /** 强调色表面上的文字色（亮绿强调 + 深字，≈ 6:1） */
        onAccent: "#1E1D1C",
        sold: "#8A857C",
        warn: "#CE9A6C",
        // 莫兰迪五色相·深底版（块面用深调 Weak，文字/描边用亮调主色）
        mist: "#8FA6B8",
        mistWeak: "#2A333B",
        sage: "#93AC8C",
        sageWeak: "#2C362A",
        clay: "#C08A70",
        clayWeak: "#3A2C26",
        sand: "#B9A277",
        sandWeak: "#38332A",
        mauve: "#A794BC",
        mauveWeak: "#332C3A",
        /** 品牌铜：仅供品牌资产（徽记月缘/散点、字标「&」），不用于 UI 语义 */
        copper: "#C9A277",
      },
      backgroundImage: {
        // Hero 底：深色莫兰迪渐变（图未加载 / 图片缺失时的兜底视觉）
        hero: "linear-gradient(155deg, #2C2927 0%, #232120 48%, #1A1918 100%)",
      },
      fontFamily: {
        // 中文页（Q-02）：Cormorant / Inter 都没有汉字，回退里必须显式给宋/黑，
        // 否则浏览器会拿任意一款默认字体，标题的衬线与正文的无衬线对比就没了
        serif: ["var(--font-serif)", "Georgia", "Songti SC", "Noto Serif SC", "serif"],
        sans: ["var(--font-sans)", "system-ui", "PingFang SC", "Microsoft YaHei", "sans-serif"],
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

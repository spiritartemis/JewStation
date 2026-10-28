import type { Config } from "tailwindcss";

/**
 * Token 来源：docs/spec/05-低保真结构与视觉规范.md §3
 * 强调色为暂定值，待站长提供 Logo/视觉参考后校准（Q-14）。
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#FBFAF8",
        surface: "#FFFFFF",
        ink: "#1F1D1B",
        muted: "#6B6560",
        line: "#E8E4DF",
        accent: "#8A7A63",
        accentWeak: "#F0EBE4",
        sold: "#9A948C",
        warn: "#9A6B4F",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      fontSize: {
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
      maxWidth: {
        shell: "1200px",
      },
    },
  },
  plugins: [],
};

export default config;

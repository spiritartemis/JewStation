import type { Config } from "tailwindcss";

/**
 * Token 来源：docs/spec/05-低保真结构与视觉规范.md §3
 * 色系：莫兰迪（低饱和 + 灰调），色板明细见 docs/视觉规范-莫兰迪色板.md
 * 强调色为暂定值，待站长提供 Logo/视觉参考后校准（Q-14）。
 *
 * 对比度：ink #35322E / accent #5F6F69 与底色（bg、Weak 系列）均 ≥ 4.5:1（WCAG AA）。
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 中性基底（雾米白 / 瓷白 / 雾色带）
        bg: "#F3F0EC",
        surface: "#FBF9F6",
        band: "#EDE8E1",
        ink: "#35322E",
        muted: "#7C746A",
        line: "#DED8D0",
        // 主强调：莫兰迪雾青（CTA、选中态、角标）
        accent: "#5F6F69",
        accentWeak: "#E6E7E1",
        sold: "#948B81",
        warn: "#A0705C",
        // 莫兰迪五色相（块面用 Weak，描边/点缀用主色）
        mist: "#A7B2B8",
        mistWeak: "#E2E6E8",
        sage: "#A9B3A6",
        sageWeak: "#E5E8E0",
        clay: "#C0A79C",
        clayWeak: "#EEE5DF",
        sand: "#CFC5B6",
        sandWeak: "#F0EAE2",
        mauve: "#A7989F",
        mauveWeak: "#EAE4E7",
      },
      backgroundImage: {
        // Hero 底：雾青 → 沙米的莫兰迪渐变（无实拍图时即为正式视觉）
        hero: "linear-gradient(155deg, #E2E5E1 0%, #E9E2D9 48%, #DAD2CA 100%)",
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

import imageLoader from "@/lib/image-loader";

/**
 * 「飞入购物袋」动效（0.4.3）
 *
 * 点「加入购物袋」时，一枚带着本商品缩略图的圆形小徽章从加购按钮中心抛出，
 * 沿一条弧线飞到右侧「查看购物袋」按钮并缩没，落点按钮再弹一下。
 * 用 Web Animations API 直接操作一个挂在 body 上的临时节点，而不是往 React 树里
 * 塞一个 fixed 层：连点不会触发一堆 re-render，动画结束自我清理，也不会被
 * 详情页里任何 `overflow:hidden` / `transform` 祖先裁掉。
 *
 * 三个必须照顾到的边界：
 * 1. `prefers-reduced-motion` —— 直接跳过飞行，只保留落点反馈与读屏播报；
 * 2. 老浏览器没有 `Element.animate` —— 同上降级，绝不因为动效把加购弄失败；
 * 3. 标签页被切到后台时 finish 可能迟迟不来 —— 加一道超时兜底删节点。
 */

const CHIP_PX = 64;
const FLIGHT_MS = 760;

type FlyOptions = {
  /** 起点：加购按钮的视口矩形 */
  from: DOMRect;
  /** 终点：查看购物袋按钮的视口矩形 */
  to: DOMRect;
  /** 商品主图；无实拍图时改画一枚线描宝石 */
  image: { url: string } | null;
  /** 落到袋子按钮那一刻触发（按钮弹跳） */
  onLand?: () => void;
};

/** 无实拍图 / 图片加载失败时画的线描宝石；静态字符串，无外部输入 */
const GEM_GLYPH =
  '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--c-accent)" stroke-width="1.3" stroke-linejoin="round">' +
  '<path d="M12 2.5 20.5 9 12 21.5 3.5 9 12 2.5Z"/>' +
  '<path d="M3.5 9h17M12 2.5 8.8 9 12 21.5 15.2 9 12 2.5Z"/>' +
  "</svg>";

function buildChip(image: FlyOptions["image"]): HTMLDivElement {
  const chip = document.createElement("div");
  chip.setAttribute("aria-hidden", "true");
  chip.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    `width:${CHIP_PX}px`,
    `height:${CHIP_PX}px`,
    "z-index:80",
    "pointer-events:none",
    "border-radius:9999px",
    "overflow:hidden",
    "display:grid",
    "place-items:center",
    "border:2px solid var(--c-accent)",
    "background:var(--c-surface)",
    "box-shadow:0 0 0 4px rgba(143,168,145,.2), 0 12px 32px rgba(0,0,0,.5)",
    "will-change:transform,opacity",
  ].join(";");

  if (image?.url) {
    const img = document.createElement("img");
    // 优先复用页面上已经加载完成的大图（ProductGallery 打了 data-product-hero）：
    // 冷访时另取 240 档要绕过网关回源 2–3s，而飞行只有 760ms，等图到了圆牌早消失了。
    // 复用 currentSrc 是零网络、零解码等待，且跟随用户当前翻到的那一张图。
    const hero = document.querySelector<HTMLImageElement>("img[data-product-hero]");
    const loaded = hero?.complete && hero.naturalWidth > 0 ? hero.currentSrc : "";
    // 大图万一没加载出来（懒加载 / 无实拍图），再退回构建期预生成的 240 档静态 WebP
    img.src = loaded || imageLoader({ src: image.url, width: 240 });
    img.alt = "";
    img.decoding = "async";
    img.style.cssText =
      "width:100%;height:100%;object-fit:cover;object-position:center 58%;transform:scale(1.45);display:block";
    // 兜底：万一两张图都取不到，画宝石而不是留一个破图空圆圈
    img.onerror = () => {
      chip.innerHTML = GEM_GLYPH;
    };
    chip.appendChild(img);
  } else {
    chip.innerHTML = GEM_GLYPH;
  }
  return chip;
}

/** 落点按钮的一次轻弹 + 描边扩散；重复连点时每次都会重新播一遍 */
export function popBagButton(el: HTMLElement | null): void {
  if (!el || typeof el.animate !== "function") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  el.animate(
    [
      { transform: "scale(1)", boxShadow: "0 0 0 0 var(--c-accent)" },
      {
        transform: "scale(1.045)",
        boxShadow: "0 0 0 5px var(--c-accent-weak)",
        offset: 0.42,
      },
      { transform: "scale(1)", boxShadow: "0 0 0 0 transparent" },
    ],
    { duration: 420, easing: "ease-out" },
  );
}

export function flyToBag({ from, to, image, onLand }: FlyOptions): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    onLand?.();
    return;
  }

  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const probe = document.createElement("div");
  if (reduced || typeof probe.animate !== "function") {
    onLand?.();
    return;
  }

  // 全部用视口坐标（getBoundingClientRect），配合 position:fixed，滚动中也不会偏
  const half = CHIP_PX / 2;
  const x0 = from.left + from.width / 2 - half;
  const y0 = from.top + from.height / 2 - half;
  const x1 = to.left + to.width / 2 - half;
  const y1 = to.top + to.height / 2 - half;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const vertical = Math.abs(dy) > Math.abs(dx);

  // 桌面端两按钮并排 → 抛一道明显的抛物线；移动端上下堆叠 → 只轻微上抛，
  // 否则图标会先冲到屏幕顶端再掉下来，看着像跑错方向
  const lift = vertical
    ? Math.min(44, Math.abs(dy) * 0.18)
    : Math.min(108, 40 + Math.abs(dx) * 0.22);
  const apexY = Math.min(y0, y1) - lift;
  const midX = x0 + dx * 0.5;

  const chip = buildChip(image);
  chip.style.transform = `translate3d(${x0}px, ${y0}px, 0)`;
  document.body.appendChild(chip);

  const animation = chip.animate(
    [
      {
        offset: 0,
        transform: `translate3d(${x0}px, ${y0}px, 0) scale(1) rotate(-8deg)`,
        opacity: 0.92,
        easing: "cubic-bezier(.22,.72,.3,1)",
      },
      {
        offset: 0.55,
        transform: `translate3d(${midX}px, ${apexY}px, 0) scale(0.86) rotate(12deg)`,
        opacity: 1,
        easing: "cubic-bezier(.5,0,.78,.42)",
      },
      {
        offset: 1,
        transform: `translate3d(${x1}px, ${y1}px, 0) scale(0.3) rotate(0deg)`,
        opacity: 0.2,
      },
    ],
    { duration: FLIGHT_MS, fill: "both" },
  );

  let landed = false;
  const finish = () => {
    chip.remove();
    if (!landed) {
      landed = true;
      onLand?.();
    }
  };
  animation.onfinish = finish;
  animation.oncancel = finish;
  // 后台标签页里 WAAPI 可能不推进：超时兜底，绝不留一个飘着的节点
  window.setTimeout(finish, FLIGHT_MS + 800);
}

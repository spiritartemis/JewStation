/**
 * 「从列表点进商品」的返回位置记录（2026-11-03）
 *
 * BackLink 与 ScrollReturnTracker 共用一个 key 与一套读写：
 *  - 点击商品链接的那一刻写入（谁是列表、滚到哪儿）
 *  - 回到同一地址时读出并消费（恢复滚动）
 *  - 商品页的返回按钮也读它：有记录就说明"确实是从站内某页点进来的"，
 *    可以安全地 router.back()；没有记录就是直接打开的分享链接，退到品类页。
 *
 * 之所以不靠 window.history.state.idx：App Router 的 history.state 里只有
 * __NA / __PRIVATE_NEXTJS_INTERNALS_TREE，没有数字序号，读出来恒为 0，
 * 会让人误判成"没有上一页"。
 */

const KEY = "mm:return-scroll";
/** 记录有效期：太久以前的位置不该再生效（比如同一标签页隔天再用） */
const MAX_AGE_MS = 30 * 60 * 1000;

export type ScrollMemory = { url: string; y: number; t: number };

/** 当前地址（含查询串）：筛选、搜索的关键词都在查询串里，必须一起算 */
export function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export function readScrollMemory(): ScrollMemory | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ScrollMemory>;
    if (typeof parsed.url !== "string" || typeof parsed.y !== "number") return null;
    const t = typeof parsed.t === "number" ? parsed.t : 0;
    if (Date.now() - t > MAX_AGE_MS) return null;
    return { url: parsed.url, y: parsed.y, t };
  } catch {
    // 隐私模式 / 存储被禁：当作没有记录，一切退回默认行为
    return null;
  }
}

export function writeScrollMemory(memory: ScrollMemory): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* ignore */
  }
}

export function clearScrollMemory(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** 站内是否"刚有一个页面把用户送了过来"：返回按钮据此决定是 back 还是回品类页 */
export function hasReturnTarget(): boolean {
  return readScrollMemory() !== null;
}

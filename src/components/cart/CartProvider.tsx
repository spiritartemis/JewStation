"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CART_STORAGE_KEY,
  maxQtyFor,
  cartItemCount,
  lineKeyOf,
  sanitizeCart,
  type CartLine,
  type CartOption,
} from "@/lib/cart";

/**
 * 购物袋状态（m-1c / 1c-0）
 *
 * 存 localStorage，不落服务端：m-1c 阶段没有账号体系（订阅与账户在 m-1d/1e），
 * 游客袋存在客户端是行业常态，也避免为「没登录也要能放东西」发明一个假会话。
 *
 * 三个必须处理好的细节：
 * 1. **首帧不能读 localStorage** —— 服务端不知道用户袋里有几件，直接读会 hydration 不匹配。
 *    所以 `mounted` 之前一律按空袋渲染，UI 用 `ready` 区分「还没读」和「真的空」。
 * 2. **跨标签同步**：另一个标签改了袋子，本标签靠 `storage` 事件跟上，
 *    否则角标和袋子页会各说各话。
 * 3. **写回时机**：任何变更都整体写回（购物袋很小，没必要做 diff）。
 */

type CartContextValue = {
  lines: CartLine[];
  count: number;
  /** 首次从 localStorage 读完为 true；之前不要显示「袋子是空的」 */
  ready: boolean;
  add: (input: Omit<CartLine, "key" | "qty"> & { qty?: number; options: CartOption[] }) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  /** 0.4.9：购物袋批量勾选删除 / 清空 */
  removeMany: (keys: string[]) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);
  /** 首次读盘是否完成：避免「读之前先把空数组写回去」把用户的袋子清空 */
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY);
      if (raw) setLines(sanitizeCart(JSON.parse(raw)));
    } catch {
      // 隐私模式 / 配额满 / 脏 JSON：一律当空袋，不让读盘失败白屏
    }
    hydrated.current = true;
    setReady(true);
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // 写不进去就算了：本次会话内的内存状态仍然可用
    }
  }, [lines]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== CART_STORAGE_KEY) return;
      try {
        setLines(e.newValue ? sanitizeCart(JSON.parse(e.newValue)) : []);
      } catch {
        /* 忽略了脏数据，保持当前状态 */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const add = useCallback<CartContextValue["add"]>((input) => {
    const { qty = 1, options = [], ...rest } = input;
    const key = lineKeyOf(rest.slug, options);
    // 0.4.9：上限统一由 maxQtyFor 按站点配置 + 库存重算，不再写死 9
    const maxQty = maxQtyFor(rest.maxQty, rest.oneOfAKind);

    setLines((prev) => {
      const i = prev.findIndex((l) => l.key === key);
      if (i === -1) {
        return [...prev, { ...rest, key, options, qty: Math.min(maxQty, qty), maxQty }];
      }
      // 已在袋中：数量相加，但不越过上限（孤品上限 1，加第二次不会变 2）
      const next = [...prev];
      const merged = Math.min(maxQty, next[i].qty + qty);
      next[i] = { ...next[i], qty: merged };
      return next;
    });
  }, []);

  const setQty = useCallback((key: string, qty: number) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const clamped = Math.max(0, Math.min(l.maxQty, Math.floor(qty)));
        return { ...l, qty: clamped };
      }).filter((l) => l.qty > 0),
    );
  }, []);

  const removeMany = useCallback((keys: string[]) => {
    const drop = new Set(keys);
    setLines((prev) => prev.filter((l) => !drop.has(l.key)));
  }, []);

  const remove = useCallback((key: string) => removeMany([key]), [removeMany]);

  /** 只清购物袋本身，绝不碰订单历史（mm.orders.v1）——两者是独立的 localStorage 键 */
  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartContextValue>(
    () => ({ lines, count: cartItemCount(lines), ready, add, setQty, remove, removeMany, clear }),
    [lines, ready, add, setQty, remove, removeMany, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/** Provider 之外调用会抛错：说明组件挂错了位置，静默返回空袋只会掩盖问题 */
export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart 必须在 <CartProvider> 内使用");
  return ctx;
}

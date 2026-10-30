"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { ProductOption } from "@/lib/types";

/**
 * 规格选中态的共享上下文（2026-10-30）
 *
 * 规格选择器在页面上方，尺寸/开合事实行在下方，两处隔着材质、重量等静态行。
 * 选中态必须两处共享：选了 18 码，上面「尺寸」行的数字要跟着变；选了死圈，
 * 「开合方式」行要写死圈的做法。因此把状态提到 Provider，选择器与事实行各取所需。
 *
 * 只存**下标**（"0"/"1"），展示时再过语言 —— 切语言不会丢选中态。
 */
type SpecState = {
  options: ProductOption[];
  selected: Record<string, number>;
  select: (group: string, index: number) => void;
};

const SpecContext = createContext<SpecState | null>(null);

export function ProductSpecProvider({
  options,
  children,
}: {
  options: ProductOption[];
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<Record<string, number>>(() =>
    Object.fromEntries(options.map((o) => [o.name, 0])),
  );

  const value = useMemo<SpecState>(
    () => ({
      options,
      selected,
      select: (group, index) => setSelected((s) => ({ ...s, [group]: index })),
    }),
    [options, selected],
  );

  return <SpecContext.Provider value={value}>{children}</SpecContext.Provider>;
}

/** 无 Provider 时返回 null（组件退化为自带本地状态， standalone 仍可用） */
export function useProductSpec(): SpecState | null {
  return useContext(SpecContext);
}

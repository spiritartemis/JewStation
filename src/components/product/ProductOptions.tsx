"use client";

import { useState } from "react";
import { optionName, optionValueLabel, type ProductOption } from "@/lib/types";
import type { Locale } from "@/i18n/config";

/**
 * 可选规格选择器（Q-06）
 *
 * 手链的「开口 / 死圈」是同一款的两种规格：共用一条商品、一个价格、一份库存，
 * 用户在这里选的是**做哪一版**，不是一个新商品。戒指码数、项链链长同理。
 *
 * m-1c 接购物车时，selected 会作为 line item 的 option 传给结账；
 * 本条线只做选择与展示，不做假加购。
 *
 * 内部只存下标（"0"/"1"），展示时再过语言 —— 这样切换语言不会丢选中态，
 * 也不会出现"选的是中文、值是英文"的错位。
 */
export function ProductOptions({
  options,
  locale,
}: {
  options: ProductOption[];
  locale: Locale;
}) {
  const [selected, setSelected] = useState<Record<string, number>>(() =>
    Object.fromEntries(options.map((o) => [o.name, 0])),
  );

  return (
    <div className="mt-sp5 space-y-sp4">
      {options.map((opt) => {
        const name = optionName(opt, locale);
        const index = selected[opt.name] ?? 0;

        return (
          <fieldset key={opt.name}>
            {/* 图例只写规格名：选中态由芯片本身表达，右侧再重复一遍同样的字只是噪音 */}
            <legend className="text-aux uppercase tracking-[0.14em] text-muted">{name}</legend>
            <div className="mt-sp2 flex flex-wrap gap-sp2">
              {opt.values.map((value, i) => {
                const active = i === index;
                return (
                  <label
                    key={value.label}
                    className={`inline-flex h-11 cursor-pointer items-center rounded-btn border px-sp4 text-body transition-colors duration-fade ${
                      active
                        ? "border-accent bg-accentWeak text-ink"
                        : "border-line text-ink hover:border-accent/60"
                    }`}
                  >
                    <input
                      type="radio"
                      name={opt.name}
                      value={i}
                      checked={active}
                      onChange={() => setSelected((s) => ({ ...s, [opt.name]: i }))}
                      // 视觉上由外层 label 承担选中态；原生 radio 隐藏但保留键盘与读屏
                      className="sr-only"
                    />
                    {optionValueLabel(value, locale)}
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

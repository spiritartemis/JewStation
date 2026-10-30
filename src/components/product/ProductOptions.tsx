"use client";

import { useState } from "react";
import { optionName, optionValueLabel, optionValueNote, type ProductOption } from "@/lib/types";
import type { Locale } from "@/i18n/config";
import { useProductSpec } from "./ProductSpecContext";

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
 *
 * 只有**一种做法**的规格不渲染选择器（2026-10-30）：单个芯片没有可选项可言，
 * 它的值由下方「开合方式」事实行直接说明，避免页面上出现一个点不动的假按钮。
 */
export function ProductOptions({ locale }: { locale: Locale }) {
  const ctx = useProductSpec();
  const options = ctx?.options ?? [];
  const [local, setLocal] = useState<Record<string, number>>(() =>
    Object.fromEntries(options.map((o) => [o.name, 0])),
  );
  const selected = ctx?.selected ?? local;
  const select = ctx?.select ?? ((group: string, index: number) =>
    setLocal((s) => ({ ...s, [group]: index })));

  const choosable = options.filter((opt) => opt.values.length > 1);
  if (choosable.length === 0) return null;

  return (
    <div className="mt-sp5 space-y-sp4">
      {choosable.map((opt) => {
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
                    title={optionValueNote(value, locale) || undefined}
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
                      onChange={() => select(opt.name, i)}
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

/**
 * 「只有一种做法」时的说明行
 *
 * 单值规格不渲染芯片（没得选就不该摆一个假按钮），做法直接在这里写明：
 * 「款式：开口 —— 可微调，多数手腕都能戴」。有多种做法时不在这里重复，
 * 由下方「开合方式」行跟随选择显示，避免同一句话在页面上出现两遍。
 */
export function ProductOptionNote({ locale }: { locale: Locale }) {
  const ctx = useProductSpec();
  if (!ctx) return null;
  const withNote = ctx.options.filter(
    (opt) => opt.values.length === 1 && opt.values.some((v) => optionValueNote(v, locale)),
  );
  if (!withNote.length) return null;

  return (
    <>
      {withNote.map((opt) => {
        const index = ctx.selected[opt.name] ?? 0;
        const value = opt.values[index];
        const note = value ? optionValueNote(value, locale) : "";
        if (!note) return null;
        return (
          <p key={opt.name} className="mt-sp3 max-w-[52ch] text-aux text-muted">
            {optionName(opt, locale)}：{note}
          </p>
        );
      })}
    </>
  );
}

import { notFound } from "next/navigation";

/**
 * 未匹配路径的兜底（2026-11-02）
 *
 * 只放 `app/[locale]/not-found.tsx` 是不够的：**访问一个根本不存在的地址时，
 * Next 用的是根级 not-found，而不是 [locale] 下的那份**，结果是访客看到的是
 * 框架自带的英文 "This page could not be found"，中文站也一样。
 * 只有代码里显式调用 notFound()（比如商品/政策 slug 不存在）才会渲染 [locale]/not-found。
 *
 * 这个 catch-all 把「路由没命中」也收进来，统一交给 [locale]/not-found.tsx 处理，
 * 于是 404 页能跟着 URL 判定语言、链接也带对前缀。
 */
export default function CatchAll(): never {
  notFound();
}

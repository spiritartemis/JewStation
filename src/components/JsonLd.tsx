import type { JsonLd } from "@/lib/structured-data";

/**
 * JSON-LD 渲染器
 *
 * 用 <script type="application/ld+json"> 输出，内容来自服务端可计算的数据，
 * 不含用户输入；仍按规范做 `<` 转义以防注入。
 */
export function JsonLdScript({ data }: { data: JsonLd | JsonLd[] }) {
  const payload = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      // 内容为受控的常量结构，非用户输入
      dangerouslySetInnerHTML={{ __html: payload }}
    />
  );
}

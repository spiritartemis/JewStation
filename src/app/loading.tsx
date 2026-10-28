/**
 * 加载态（01 §5：骨架屏，不跳动）
 * 骨架尺寸与真实卡片一致（图 4:5 + 两行文字），避免加载完成时布局跳动。
 */
export default function Loading() {
  return (
    <div className="shell py-sp5" aria-busy="true" aria-live="polite">
      <div className="h-5 w-40 animate-pulse rounded bg-accentWeak" />
      <div className="mt-sp5 grid grid-cols-2 gap-sp5 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>
            <div className="aspect-[4/5] w-full animate-pulse rounded-img bg-accentWeak" />
            <div className="mt-sp3 h-3 w-3/4 animate-pulse rounded bg-accentWeak" />
            <div className="mt-sp2 h-3 w-1/3 animate-pulse rounded bg-accentWeak" />
          </div>
        ))}
      </div>
    </div>
  );
}

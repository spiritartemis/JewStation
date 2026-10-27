# 往 brief 里加新数据面

> 判据先行：**加一段 § 不改渲染；加判据 § 不改结构；加外域数据 § 不进 core**。
> 三条轴对应三种成本，选错了会把「一屏简报」做大成第二个 `gd board`（652 KB 那种）。

## 决策：这笔数据该走哪条轴？

```
是「本仓板上已有的事实」吗？
├─ 是 → 是「一个数/一行结论」还是「新的一屏」？
│       ├─ 结论型（矛盾 / 风险 / 待拍） → 轴② 加 drift 判据（最便宜）
│       └─ 需要展开看细节             → 轴① 加一段
└─ 否（注册项目 / producer 健康 / 席位）
        → 轴③ app 层聚合，core 不动
```

## 轴①：加一段（core）

1. `scripts/lib/brief.mjs` 的 `BRIEF_SECTIONS` 加名字（**顺序即渲染顺序**）
2. 写 `xxxOf(facts)` 纯函数 —— 只吃 `collectFacts()` 的结果，**不自己读盘**
   （自己读盘 = 第二次全板扫描，0.36 s 会变成 0.8 s，且可能与主口径分叉）
3. `buildBrief` 里 `if (want.has("xxx")) payload.xxx = xxxOf(f)`
4. `renderBrief` 加渲染块，**续行缩进 9 空格**（对齐 `坐标`/`鸟瞰`/`上次`/`漂移` 三个全角字的宽度）
5. `entry/cli.md` 的 brief 章节 + `skills/gd-core/references/brief.md` 字段表同步
6. `core-brief-e2e` 加断言；**顺手确认总预算没破**（默认档 ≤34 行 / ≤4600 字节）

段函数的契约：纯函数、无副作用、不抛异常（拿不到数据返回 `[]` 或 `null`，由渲染决定跳不跳）。

## 轴②：加一条漂移判据（core · 最便宜）

`DRIFT_RULES` 里加一行数据即可，**渲染与 JSON 结构都不用动**：

```js
{
  code: "BACKUP_STALE",           // 稳定机读，大写蛇形；**永不改**（外部按它判）
  level: "warn",                  // warn = 账上矛盾 / 可能丢工作；info = 只是提醒
  hit: (f) => f.reqs.filter(...), // 返回命中数组（空数组 = 不出现）
  text: (h) => `…`,               // 单项文案（单条命中时用它）
  cmd: (h) => `gd …`,            // 建议命令（会进「建议」行）
  idOf: (h) => h.id,              // 机器面的 id
  group: (hits, ids) => `…`,      // 可选：多条命中合并成一行时的文案
  single: false,                  // 可选：true = 只取第一条（聚合型判据，如「未推送 N 个提交」）
}
```

三条纪律：

1. **`hit` 里不许读盘、不许跑命令** —— 它拿到的只有 `collectFacts()` 的 facts。
2. **拿不到事实就不命中**，不要用 `0` / `null` 兜底（「无 upstream ⇒ 不报未推送 0」就是这条）。
3. **`code` 一旦发出去就不改**（改 code = 破坏消费方）。

## 轴③：加外域数据（app 层 · 不进 core）

注册项目、producer 健康、席位占用这些**不属板账**的事实，走 app 层聚合：

```bash
gd brief --json --with-projects    # app 侧命令：先取 core 的 brief payload，再补一段
```

- **core 侧不加任何 import**（`core-layer-guard.mjs` 的 `CORE_MODULES` 会红）
- app 侧复用 `buildBrief()` 的 `payload`，**别重算板账**（重算就是两套口径）
- 没装 app 的机器上 `--with-projects` 明确报「需要完整 CLI」，不要静默降级

## 自查清单（提交前）

- [ ] 默认档仍在预算内（`core-brief-e2e` 的体积/行数断言绿）
- [ ] 新 `code` 进了 `entry/cli.md` 的 code 表和 `references/brief.md`
- [ ] `--json --section <新段>` 单取可用
- [ ] 零写（跑完 `git status` 无变化）
- [ ] 没新增子进程（除既有的那一次可选 git）

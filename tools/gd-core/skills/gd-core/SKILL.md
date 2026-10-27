---
name: gd-core
description: 用 gd-core 的「板」管开发进度——两轴账（开发轴 里程碑→需求→任务 · 发布轴 对外版本→需求成员）、会话认领与隔离工作区、交件与验收、结版；外加查进度与播报（gd brief 一条命令出五段简报 + 固定呈现口径）。当用户提到 gd、gd-core、板、需求、任务、里程碑、版本线、结版、认领、交件、验收、进度到哪了、下一步做什么、交接，或要在某个 git 仓里建账 / 拆活 / 查进度 / 推进一个交付批次时加载。
---

# gd-core

gd-core = 一块**板**（账的落点 + 编号命名空间）+ 一套**会话工作法**。
它只管「要做什么、谁在做、做完没有」，不管代码怎么写。

**两侧分工**：**写侧**（建账 · 认领 · 交件 · 验收 · 结版）见下面各份；**读侧**（查进度 · 下一步 · 怎么向人汇报）见 `references/status.md`。

## 先定位当前板

```bash
gd-core core status                  # 板 id / 板根 / 执行体 / 模式（session 或 seat）
gd-core core init --id <板id>        # 还没有板时（必须在 git 工作区内）
```

没定位到板就别动账：`cd` 到有板的那块仓，或 `GD_BOARD=<板根目录>` 临时切板。

## 四条铁律

1. **开/结里程碑必须用户批准**——`milestone reach` / `reopen` 是「这条开发线做完了」的宣告，不许替用户决定；对外版本 `release freeze` / `tag` 同理须用户拍。存量 `ver reach` 仍须 `--confirm <x.y.z>` 点名（老格式需求验收时子版结版**自动完成**，不用单独拍；开发形态需求没有子版这一步）。
2. **账是真相，视图可重算**——`roadmap.md` 之类都是派生视图，手改无效；要改就改账。
3. **不跳层、不混轴**——需求挂开发线（线段在 id 里），里程碑就是那条线（**不带版号**）；版本号归发版流程（`gd release`）。动板前先把「里程碑 | 需求 | 任务 | 优先级」排表给用户过一眼。
4. **core 不碰 app 面**——席位 / 工作站 / 注册项目 / 自动提交都在完整 CLI；core 面遇到这类命令会明确指路，别绕。

## 按任务读哪份

| 你在做什么 | 读哪个 reference |
|---|---|
| 拆需求、建任务、认领、开工、交件、验收 | `references/workflow.md` |
| 开版 / 结版 / 缺陷分档 / 模式闸 / 边界 | `references/discipline.md` |
| 查命令与参数（含 core 面与完整 CLI 的差别） | `references/commands.md` |
| 进度报表、备份与跨机、多会话并行 | `references/ops.md` |
| **查进度、下一步、交接、怎么向人汇报** | `references/status.md` |
| 简报字段含义 / drift code 全表 / 外部消费方 | `references/brief.md` |
| 把简报转述给人（模板 + 正反例） | `references/present.md` |
| 往 brief 里加新数据面 | `references/expand.md` |
| 报错了、被闸门拦了 | `references/errors.md` |

## 最常用的六条

```bash
gd-core milestone add "<名>" --target <YYYY-MM-DD> --alias <意涵缩写>
gd-core req new "<需求标题>" --line 1a              # 需求坐标 = 开发线，id 自动 R-<板>-1a-<线内序号>
gd-core task add <需求id> --task "local:<任务标题>"
gd-core work claim <任务id> && gd-core work start <任务id>   # 认领 = claim（带占用租约）
gd-core handoff <任务id> --done "<做成了什么>"               # 交件：有 done 无 remain ⇒ 一次到位进 review
gd-core check <任务id> --pass --note "<结论>"
```

> 完整 CLI 环境里把 `gd-core` 换成 `gd`（族名相同）；只有 core 包时一律 `gd-core`。
> 交件的三条闸门（认领只归 `work claim` · 未派不可交 · 他人占用拒）见 `references/workflow.md` §2。

**交件给证据、不给结论**（软建议，非闸门）：验收人常是另一个会话，只看得见账和代码——带 `--artifact`、`done` 对得上判据、`decision` 写清取舍与隐含假设，对方才能独立复核。细则见 `references/workflow.md` §3.1。

# gd-core — 会话级核心工作流（core 层分发壳）

> 设计权威源：[docs/gd-core-session-workflow-design.md](../docs/gd-core-session-workflow-design.md)
> 上手说明（0 基础 · 配 AI 用 · 任何项目通用）：[docs/gd-core-getting-started.md](../docs/gd-core-getting-started.md)
> 依赖层铁律：**core 内零 import app**（机器守卫 `scripts/core-layer-guard.mjs`）
> 回归：`node scripts/core-pack-e2e.mjs`（目录形态）· `node scripts/core-pack-build-e2e.mjs`（装配自检） · `node scripts/core-skill-e2e.mjs`（工作法 skill 形态）· `node scripts/core-dist-e2e.mjs`（pack + 安装态）· `node scripts/core-chain-e2e.mjs`（全链路一气跑通）· `node scripts/core-flow-e2e.mjs`（交件 / 验收）· `node scripts/core-vers-e2e.mjs`（结版 / 版本线）

## 这是什么

核心工作流的**可入口形态**：板（board）+ 三层账（里程碑 → 需求 → 任务）+ 会话认领 + 并发隔离。
它只依赖 **Node + git**，不需要席位、工作站、producer、`~/.gd/gdmain.yaml`。

```bash
# 任一 git 仓 → 一块可用的板
gd-core core init --id gm          # 建 <git-common-dir>/gdtwork/board.yaml + 账骨架 + 基线 tag
gd-core core status                # 当前板（id / 板根 / 执行体 / 模式）
gd-core milestone add "0.19.0 …" --target 2026-11-15 --alias 0.19.0
gd-core req new "某个需求" --subver 0.19.0   # 编号 R-<板id>-00N 锁内自增（--kind bug ⇒ B-<板id>-00N，独立计数）
gd-core task add R-<板id>-001 --task "local:第一件活"
gd-core handoff <任务id> --done "做完了"        # 交件（四要素 + 件账）
gd-core check <任务id> --pass                  # 验收
gd-core ver list                              # 子版清单（完成度派生自需求 · 结版是人的宣告）
gd-core ver reach 0.19.0 --confirm 0.19.0     # 结版（须点名 · 铁律）
gd-core ver claim 0.19                        # 认领版本线（谁负责这条 x.y）
gd-core work claim <任务id>         # 认领（租约 15 分钟，动账自动续期）
gd-core work start <任务id>         # 隔离工作区（worktree + task/<id> 分支）
gd-core work submit|land <任务id>   # 精确提交 + rebase / 串行快进合入
gd-core core roadmap --write        # 三层账派生视图写回 roadmap.md（只换标记块）
# —— 读面（0.24.2 R-gm-083 起随包）——
gd-core board                       # 看板：4 态泳道 + 事件时间线
gd-core task list [--todo|--to-check] [--status <s>]… [--req <需求id>]
gd-core task show <任务id>           # 单任务详情（input / 交付件 / 事件 / 可流转 / 下一步）
gd-core req status <需求id>          # 需求详情（归属 / 子版结版态 / 版本线 / 任务 4 态）
gd-core milestone progress [<id>]    # 里程碑进度（与 roadmap 派生视图同源）
gd-core --version                   # 版本自证（本包 package.json）
```

> 上例全部由**本包自足**（0.23.0 起 `milestone add` / `req new` / `task add` / `handoff` / `check` 已 core 化，0.23.1 补上 `ver` 结版族，0.24.2 补上**读面**（board / task list|show / req status / milestone progress）——「读 + 写全链」在包里能走完整圈）。
> 落点缺省就是本仓的板；要写**注册项目账**（`--project`）或要写后自动提交 / 推送，才需要**完整 CLI**。

## 分发形态（0.19.0 现状）

| 项 | 状态 |
|---|---|
| 入口随身（`core/bin/gd` 三级解析：`GD_MAIN_LOCAL` → `~/.gd/gdmain.yaml` → 仓内开发态） | ✅ |
| **真·自包含闭包**（`core` / `work` / 登账三族 / 流转两族 / 结版族 / **读面四族**） | ✅ **已翻转**（`gd.selfContained = true`）：`core/entry.mjs` 的静态闭包**现算**（闭包清单是派生件，仓库不跟踪、只随产物分发；守卫 `scripts/core-closure-check.mjs`）。孤立目录（无 `scripts/gd.mjs`、无 `~/.gd`）实测 `core status` / `core roadmap` / 登账三族 / 交件与验收 / 结版与版本线 / **board · task list·show · req status · milestone progress** 照跑 |
| 其余命令（`milestone` 的 list/update/reach · `req` 的 update/apply · `task` 的 gen · `ver` 之外的版本类命令） | 仍是**完整 CLI**（要处理注册项目 / 写后自动提交这类宿主上下文）；`core/bin/gd` 在能找到完整 CLI 时转交，找不到时明确告知。**读面不在此列**——board / task list·show / req status / milestone progress 已随包 |
| 版本自证（`gd-core --version` → 本包 `package.json`） | ✅（0.23.0；仓内开发态会标注「版本随装配注入」） |

闭包怎么守（照 `seatpack.mjs: seatCliClosure` 的做法）：从 `core/entry.mjs` 出发收集全部相对导入，
断言 ① 每个文件都在 core 允许前缀内 ② 零 app 文件（席位 / 工作站 / 宿主上下文 / 注册表 / `.pi`）
③ 零第三方依赖 ④ 落点只认板：闭包内不得出现 `target-guard.mjs`（注册项目账回落属 app 面，0.24.2 R-gm-083-02）。

闭包清单本身**不入库**（`.gitignore` 挡着）：它是机器按当时磁盘算出的快照，挂了会跟并行开发互相撞；
要一份供人查阅的副本跑 `node scripts/core-closure-check.mjs --write`。

> 为此把 `lib/git.mjs` 里的**纯 git 操作**抽成了 `lib/gitcore.mjs`（`git.mjs` 反向 re-export，实现仍一份）——
> 否则 core 闭包会被「项目库提交/推送」那条 app 链拖进注册表与版本号。

## 装配与私有分发（0.23.0）

`core/` 目录只有 5 个壳文件，闭包其余 35 个在 `scripts/` 下——**直接 `npm pack core/` 打出来的包 import 即断**。装配由脚本完成：

```bash
node scripts/core-pack.mjs                    # → dist/gd-core（镜像布局：core/** + scripts/**）
node scripts/core-pack.mjs --version 0.23.0   # 显式指定版本
cd dist/gd-core && npm pack                   # → inkwill-gd-core-0.23.0.tgz
```

**版本口径**（逐级回落）：`--version` > 板账最新**登记**子版 > `blueprint/manifest.yaml`（最新**已结版**）> `core/package.json`。两者不一致时装配会打一行 drift 提示——包版本跟「在做的版本」，已结版只作参照。

**`private: true` 是护栏，不是限制**：它只挡 `npm publish`，**不影响** `npm pack` / `npm i <tarball>` / `npm link` / `npx`。要走私有 registry 时去掉这一行即可。

**验证口径**：装配目录**必须挪出本仓再测**——留在仓内时 `core/bin/gd` 的开发态上溯会摸到本仓完整 CLI，非 core 族「居然能用」，测试假绿。回归就是这条口径的机器版：

```bash
node scripts/core-dist-e2e.mjs   # 装配 → npm pack → npm i 进空宿主 → 六族真跑一遍（36 项）
```

## 与 app 层的关系

```
core（本包）                 app（席位 / 工作站 / producer 分发 / TUI）
板 · 三层账 · 认领 · 并发隔离   ← 注册注入 ← 席位解析器（registerSeatResolver）/ 席位表读取器
```

上层缺席不影响 core；`seats/index.yaml` 存在时模式自动派生为 `seat`，否则 `session`（**数据事实，不是配置**）。

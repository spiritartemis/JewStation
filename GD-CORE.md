# gd-core 协作上手（JewStation）

本仓内嵌了 **gd-core**（会话级核心工作流：板 / 三层账 / 认领 / 隔离工作区）。
拉下来就能用，**不需要 npm install、不需要装全局包**。

| 东西 | 在哪 | 说明 |
|---|---|---|
| 工具本体 | `tools/gd-core/` | 随仓提交的装配产物；版本见 `tools/gd-core/package.json` |
| 命令入口 | `tools/gd`（sh） / `tools/gd.cmd`（Windows） | 薄包装，转调 `tools/gd-core/core/bin/gd` |
| 工作方法（AI 读的操作手册） | `.pi/skills/gd-core/`、`.pi/skills/gd-qa/` | 协作方的 pi 启动后自动列为可用 skill |
| 板账（里程碑 / 需求 / 任务） | **不在仓里** | 在各自机器的 `.git/gdtwork/`，靠 git 远端的一条 `gd-board` ref 接力同步 |

---

## 0. 前置

| 需要 | 怎么确认 |
|---|---|
| Node.js >= 20 | `node -v` |
| git | `git -v` |
| 仓库读写权限 | `git pull` / `git push` 能通 |

---

## 1. 命令怎么敲

| 系统 | 写法 |
|---|---|
| Windows | `tools\gd core status` |
| macOS / Linux | `./tools/gd core status`（仓库里已带可执行位；若报 `Permission denied`，改用 `sh tools/gd core status`） |

下面一律写作 `gd <命令>`，按上表替换前缀。

---

## 2. 第一次上手（新机器必做，一次性）

```bash
gd core init --id jew          # 建板：账落在 .git/gdtwork（不入任何提交）
gd core snap --init            # 建账库：让板账本身能被 git 快照 / 备份
gd core snap --restore-remote --dry-run    # 拉远端的账 → 先看对比，不改任何东西
gd core snap --restore-remote --confirm <上面打印的 hash>   # 点名确认后才覆盖
gd core init --force --id jew  # 把 board.yaml 的 repo 行改成本机路径（见「坑 2」）
gd core status                 # 自检：板 id / 板根 / 仓库 三行都对才算好
```

> 若远端还没有账（同事还没推过），`restore-remote` 会报「远端没有 ref gd-board」——**跳过还原即可**，直接往下走。

---

## 3. 日常三步

```bash
gd brief                       # ① 看进度：坐标 / 鸟瞰 / 下一步 / 漂移
gd work next --claim           # ② 领活（认领带 15 分钟租约）
gd work start <任务id>         #    开隔离工作区（自动建分支 + worktree）
#    …… 在工作区里改代码、提交 ……
gd work submit <任务id> --message "<提交说明>"   #    交件
gd work land <任务id>          #    合回主线
gd handoff <任务id> --done "<做成了什么>"        # ③ 交件给验收人
gd check <任务id> --pass --note "<结论>"         #    验收
```

命令全集：`gd --help`；工作方法细则读 `.pi/skills/gd-core/SKILL.md`。

> `work start` 会在**代码仓同级**建 `<仓名>.wt/<单元id>/` 隔离工作区（不进仓、不污染主线），
> 改完 `work submit` 再 `work land` 合回主线。

---

## 4. 记三层账

```bash
gd milestone add "站点首发" --target 2026-12-31 --alias 0.1   # 里程碑（开发线）
gd req new "首页搭架子" --line 1a                            # 需求
gd task add R-jew-1a-0 --task "local:搭首页骨架"               # 任务
```

> 板 id 两边必须一致（本仓是 `jew`）——id 是需求编号命名空间，不一致会撞号。
> 需求 id 以命令的**实际输出**为准（形如 `R-jew-1a-0`），别照抄示例号。

---

## 5. 收工必做：把账推回远端

```bash
gd core snap --backup
```

推的是交付仓远端的一条独立 ref（缺省 `gd-board`），**不污染任何分支**。

---

## 6. 六个坑（都踩过）

1. **两机不能同时写账**。文件锁跨不了机器，同时写会各自数号 → 撞号。
   交接顺序固定：**写的人先 `--backup`，接手的人 `--restore-remote` 再写**。
2. **`board.yaml` 的 `repo:` 是本机绝对路径**。还原来的账带的是上一个人机器的路径，
   在本机不存在 → 每次还原后必须 `gd core init --force --id jew` 改回本机路径。
   （只重写 `board.yaml`，账件一律不覆盖。）
3. **非快进 push 会被 git 直接拒**（报「远端比你新」）。出路：先 `--restore-remote` 对比再推，
   **不要强推**。
4. **`--restore-remote` 是高危覆盖**：必须 `--confirm <hash>`；覆盖前自动存救援点
   `refs/gd-rescue/<时间戳>`，反悔用 `gd core snap --restore <hash> --confirm <hash>`。
5. **`tools/gd-core/` 是 vendored 副本**，升级由仓主统一重新装配覆盖；**别手改里面文件**，
   也别对它 `npm i`（`core/` 单独装是坏包）。
6. **需求 id 以命令实际输出为准**，别照抄文档里的示例号。

---

## 7. 排障

| 现象 | 处理 |
|---|---|
| `未定位到板` | 本机还没建板 → 回第 2 节跑 `gd core init --id jew` |
| `板配置的 repo 不是 git 仓库` | `board.yaml` 的 repo 行是别机路径 → `gd core init --force --id jew` |
| `远端没有 ref gd-board` | 远端还没备份过账 → 跳过还原，正常开工 |
| `远端比你新（非快进）` | 先 `gd core snap --restore-remote --dry-run` 看对比，再决定 |
| 体检有 ✗ | `gd core doctor`（并行安全体检，`--fix` 清残留占用） |
| `core 面不认识 --xxx` | 该命令属完整 CLI（app 面）→ 找仓主，不要绕 |

---

## 8. 一句话版

> 板 id 统一 `jew` · 认领用 `work claim` · 交件用 `handoff` · 验收用 `check` ·
> 收工 `snap --backup` · 接手先 `snap --restore-remote` · 还原后 `core init --force`。

---

## 9. macOS 备注

| 事项 | 说明 |
|---|---|
| 命令 | `./tools/gd <命令>`（仓里已带可执行位 755）；万一 `Permission denied` → `sh tools/gd <命令>`，或 `chmod +x tools/gd` |
| 依赖检查 | `node -v` 要 >= 20；建议用 nvm 装 Node |
| 列目录 | `ls`（macOS 自带），**不是** PowerShell 的 `Get-ChildItem -Force` |
| 行尾 | macOS 默认 LF，与仓里的 `.gitattributes` 一致，脚本不会出问题 |
| 隔离工作区 | `work start` 会在**仓库同级**建 `<仓名>.wt/`，注意给它留够磁盘空间 |
| 首次拉账 | 仓库只带工具与 skill，**不带账**；账在远端 `gd-board` ref 上，需按第 2 节还原 |

# JewStation — 项目指令

本仓用 **gd-core**（会话级核心工作流）管开发进度：里程碑 → 需求 → 任务三层账 + 认领 + 隔离工作区。

## 命令前缀（重要）

gd-core 以 **仓内 vendored 副本** 随仓提交，**没有全局 `gd-core` 命令**，一律用仓内包装脚本：

| 系统 | 写法 |
|---|---|
| macOS / Linux | `./tools/gd <命令>` |
| Windows | `tools\gd <命令>` |

底层是 `tools/gd-core/core/bin/gd`（纯 node ≥ 20，无第三方依赖）。

## 板（账）

- **板 id 固定 `jew`** —— 它是需求编号命名空间（`R-jew-1a-0`）。换 id 会和另一台机撞号，**不要另起 id**。
- 板账落在本机 `.git/gdtwork/`，**不入任何提交**；靠交付仓远端的一条 `gd-board` ref 接力同步。
- 账里的 `board.yaml` 的 `repo:` 是**本机绝对路径**。
- ⚠️ **改 `repo:` 行只改那一行**（sed），**别用 `core init --force`** —— 它重写整个 board.yaml，
  会把别人加的 `executors`（如 `owner`）静默抹掉。

## 新机器 / 接手时（一次性，按序）

```bash
./tools/gd core init --id jew          # 建板
./tools/gd core snap --init            # 建账库
./tools/gd core snap --restore-remote --dry-run
./tools/gd core snap --restore-remote --confirm <hash>   # 拉别人的账
# 把 board.yaml 的 repo 行改成本机路径（漏这步后面 work start 会报错）
# ⚠️ 只改 repo 那一行，**不要用 core init --force**（它会抹掉别人加的 executors）
sed -i '' 's|^repo: .*|repo: '"$PWD"'|' "$(git rev-parse --git-common-dir)/gdtwork/board.yaml"
./tools/gd core snap                    # 给这笔改动打个快照
./tools/gd core status                  # 自检：板 id / 板根 / 仓库 三行
```

## 日常

```bash
./tools/gd brief                       # 看进度（只读）
./tools/gd work next --claim           # 领活
./tools/gd work start <任务id>         # 开隔离工作区（仓同级 <仓名>.wt/）
cd <工作区路径> && 改代码 …
./tools/gd work submit <任务id> --message "…"
./tools/gd work land <任务id> --keep   # 注意 --keep：否则删分支，后面 handoff 会被拦
cd <工作区路径>                        # 必须在工作区里交件
./tools/gd handoff <任务id> --done "…" --artifact <件>
./tools/gd check <任务id> --pass --note "…"
./tools/gd core snap --backup          # 收工推账
```

## 铁律

1. **两机不能同时写账** —— 文件锁跨不了机器，同时写会各自数号、撞号。
   交接顺序：**写的人先 `core snap --backup`，接手的人先 `core snap --restore-remote` 再写**。
2. **收工必 `core snap --backup`** —— 账不随代码提交，不推就丢了。
3. **不跳层**：需求挂开发线（`--line 1a`），需求 id 以命令实际输出为准。
4. **结版 / 开里程碑这类对外宣告由人拍板**，AI 只能问不能替人决定。
5. **需求 / 任务 / 里程碑 id 一律照命令输出抄**，不要自己拼。

## 排障

| 现象 | 处理 |
|---|---|
| `未定位到板` | 本机还没建板 → 跑上面「新机器 / 接手时」那段 |
| `板配置的 repo 不是 git 仓库` | `board.yaml` 的 repo 行是别机路径 → 只改那一行（见上） |
| `远端没有 ref gd-board` | 远端还没备份过账 → 跳过还原，正常开工 |
| `远端比你新（非快进）` | 先 `core snap --restore-remote --dry-run` 看对比再决定，**不要强推** |
| `E_CLAIMED`（他人持有） | 等租约过期（15 分钟无心跳可抢）· 或让持有者 `core snap` 前的 `work release` |
| 体检有 ✗ | `./tools/gd core doctor`（并行安全体检，`--fix` 清残留占用） |
| `core 面不认识 --xxx` | 该命令属完整 CLI（app 面）→ 找仓主，不要绕 |

更细的报错对照：`.pi/skills/gd-core/references/errors.md`。

## 方法

工作方法（AI 按需加载）：`.pi/skills/gd-core/`、`.pi/skills/gd-qa/`。

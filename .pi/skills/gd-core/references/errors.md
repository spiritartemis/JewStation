# 报错与闸门：怎么读、怎么解

## 1. 先看这句报告在说什么

gd 的报错分三类，处理方式完全不同：

| 形状 | 含义 | 出路 |
|---|---|---|
| `✗ 不可验收：…` / `✗ 不可交件：…` / `✗ 还没 submit` / `✗ 他人持有` | **闸门**：顺序或归属不对 | 按提示补前置动作，不要 `--force` 绕过 |
| `✗ …必须点名确认` | **高危动作**缺 `--confirm` | 确认要做，再补 `--confirm <值>` |
| `✗ 该命令属完整 CLI（app 面）` | core 面故意不支持 | 装完整 CLI 或 `GD_MAIN_LOCAL=<总控仓根>` 指路 |

## 2. 常见报错对照

| 报错 | 含义 / 出路 |
|---|---|
| `E_CLAIMED` | 他人持有且租约未过期。**先看持有者是不是 `pid-<数字>`**：是 ⇒ 多半是**你自己上一条命令**（这台 shell 没设 `GD_SESSION`，每条命令一个新进程，会话退化了）。两步：`export GD_SESSION=<固定短名>` → `gd work release <任务id> --force`。持有者是正常会话号 ⇒ 等过期（15 分钟无心跳即自动可抢）或让持有者 `work release` |
| `任务 "T-x-…" 不属于本板` | 任务 id 前缀 = 板 id，跨板不认；`cd` 到那块板所在仓，或 `GD_BOARD=<板根>` |
| `板 … 处于席位语义` | 该板有 `seats/index.yaml`，任务写面归席位面（`gd seat task *`） |
| `未定位到板` | 还没 `core init`，或不在有板的仓；`GD_BOARD=<板根目录>` 可临时切板 |
| `当前目录不在 git 工作区内` | 板必须绑一个 git 工作区：先 `git init` |
| `已有板：… —— 幂等跳过` | 正常，继续用；想换新的就换个仓 |
| `Author identity unknown` | git 不知道你是谁：`git config user.name/user.email`（`--global` 一次搞定） |
| `✗ 必须点名确认：--confirm` | 结版 / 退档 / 账覆盖这类高危动作，补 `--confirm <值>` |
| `✗ 未点名就结版` 类是设计 | 铁律：结版是宣告，必须人点名 |
| `✗ 板配置的 repo 路径在本机不存在` / `✗ 板配置没记 repo` | 跨机搬板最常见：`board.yaml` **顶格**的 `repo:` 还是上一台机的绝对路径（或缩进错位读不到）。改成本机代码仓根（Windows `C:/work/repo`、Linux `/home/me/repo`），或 `gd core init --force` 自动重绑；`core doctor` 的「代码仓绑定（repo）」会先报出来 |
| `✗ 板配置的 repo 不是 git 仓根` | 路径在但不是仓根：要「含 `.git` 且 `show-toplevel` 等于自身」（软链 / junction 不算） |
| `✗ 任务 … 还没 submit` | 顺序错：`land` 之前要先 `submit` |
| `✗ 不可交件：… 没有工作单元` / `✗ 不可交件：当前在分支 X，但 … 的工作单元是 Y` | 交件闸门（0.47）：这活没在隔离工作区里干，或你现在不在那个分支上。出路：`cd` 回工作区交件；工作区已被 `land` 回收 ⇒ `gd work start <任务id>` 重开（`work list` 的路径列可查）；确需在主仓交件加 `--direct`（落事件留痕）。`--force` 越不了这条（它管占用抢占） |
| `✗ 提交失败：… 冲突` | `submit` 的 rebase 撞了：脚本已自动回滚，去工作区手工解冲突后重跑 |
| `E_SKILL_DRIFT`（`contract check --scope docs`） | 安装产物 `.pi/skills/<名>/` 落后于真源 `skills/<名>/`——改了 `references/` 没重铺。出路：`gd-core skill install --force`（**别手改副本**，下次 install 会覆盖它，改真源）。宿主那份（`~/.workbuddy-ai/skills/`）另需 `--dir <该目录> --skill <名> --force`，而它会**整目录重建**——目录里非 skill 的文件（如宿主的 `_user_meta.json`）先备份 |
| `✗ 需求 … 已验收完成`（旧口径） | **已废**：现在已完成需求可挂里程碑（只回一句「满足达成判据」的提示）；仍被拦的只有「已达成的里程碑再挂 / 解关联」（历史时间锚） |
| `✗ 不可验收：… 交付件与账不符（E_ARTIFACT_STALE）` | **真失配**：账上指纹与**落地提交**里那份内容对不上，且没有后续提交能解释（成果被回退 / 丢了）。出路：① 恢复成果（把该件改回交付时的内容并提交）再验收；② 确认无害后 `gd check <id> --pass --force`（覆盖项记进 `review.artifact_override`）。**后续任务改过 / 删过同一个文件、工作树有未提交改动 ⇒ 一律不拦**（那不是失配，只在回显里提示） |
| `✗ E_ARTIFACT_COLLIDE：… 要交的件与同需求其它任务重名` | 同需求两个任务交了**同一路径**的件（后交的会覆盖先交的）⇒ 拒后交的那件。出路：换件名（带任务 id 前缀）或换产出子目录 |
| 编号不是 `-001` | 这块板之前建过了，编号接着排；换块新板才从 001 起 |

## 3. 排查顺序（账类问题）

1. `gd-core core status` —— 我在哪块板、模式是 session 还是 seat？
2. `gd-core work list` —— 这个任务被谁持有？（会话名是 `pid-<数字>` ⇒ 裸进程会话，见 §2 的 `E_CLAIMED`）
3. 直接看账：`<板根>/board.yaml`、`<板根>/milestones.yaml`、`<板根>/reqs/index.yaml`、`<板根>/reqs/<需求id>/task-list.yaml`
4. 账坏了先备份再动：`gd-core core snap --backup`；视图不一致就跑 `gd-core core roadmap --write` 重算

**别手改账的格式**：字段语义是契约，改错会让解析失败；要改内容用命令，要查结构用 `--json`。

## 4. 不会用的时候

```bash
gd-core --help          # 全部命令
gd-core <族> --help     # 某族参数
```

# 进度视图、备份与跨机、多会话

## 1. 视图

```bash
gd-core core roadmap            # 打印两轴账渲染出的 markdown
gd-core core roadmap --write    # 写回 roadmap.md 的 <!-- gd:board-view --> 标记块（幂等）
```

- **手改视图不产生任何派生态**；视图随时可由账重算。
- 完成度、未完成任务、对外版本状态与（存量板的）子版结版态都从账算出来，不需要人工维护第二份。

## 2. 账的备份与跨机

板账落在本机 `<git-common-dir>/gdtwork`：**本机盘坏即账灭，也带不到第二台机**。
账不随代码提交（有意为之），所以备份是独立动作：

```bash
gd-core core snap --backup           # 备份：板账推到交付仓远端的一条 ref（缺省 gd-board）
gd-core core snap --restore-remote   # 还原：先做结构对比 → 点名确认 → 存救援点 → 覆盖
gd-core core snap --init             # 首次建账库（可选）
```

要点：

- 缺省推**交付仓 origin**；给一次 `--remote <url>` 就写进板账仓 origin，以后可零参数。
- **里程碑结版会自动备一次**（0.29.9）：`gd milestone reach` / `gd-core milestone reach` / 工作站「标记达成」写完就快照 + push（同一个远端判据）——无远端 / 网络失败**只警告不阻断**，补推 `gd-core core snap --backup`。其余写账**不自动推**。
- **新机首次搬板**（本地还没有板账）：`git clone -b gd-board <交付仓远端> "$(git rev-parse --git-common-dir)/gdtwork"`。
- **不会静默覆盖**：远端比你新时 push 被 git 拒（非快进），先 `--restore-remote` 对比。
- `--restore-remote` 是**高危**：必须 `--confirm <远端hash>`；覆盖前自动存 `refs/gd-rescue/<时间戳>`，反悔用 `gd-core core snap --restore <hash> --confirm <hash>`。
- **跨机不要同时写同一块板**（锁跨不了机器）；两台机各自数号 ⇒ **会撞号**，对比会把「同一 id 内容不同」标出来。
- 始末固定动作：干完活 `snap --backup`；换机开工先 `snap --restore-remote --dry-run` 看一眼。

### 换机后第一件事：修 `repo:`（B-gm-000059）

`board.yaml` 的 `repo:` 是**绝对路径**，记的是当初 `core init` 那台机的代码仓位置。搬过来以后
账照样能读（`core status` / `req list` 都正常），**一碰代码就全拒**（`gd core doctor` 会报 ✗ 代码仓绑定）：

```
✗ 板配置的 repo 路径在本机不存在：D:/old-machine/gdMain
```

改法（二选一，都在**本机**做）：

| 平台 | 手改 `board.yaml` 顶格那一行 |
|---|---|
| Windows | `repo: C:/work/gdMain` —— **正斜杠**、盘符大写；别把 `/home/…` 这种 POSIX 路径写进 Windows 板（反之亦然，跨平台搬板最容易在这里翻车） |
| Linux / macOS | `repo: /home/me/gdMain` |

- 或者 `gd-core core init --force`：旧路径在本机已失效时**自动重绑**到当前仓，并在回显里点明
  「repo 重绑 … → …」；`executors` 名册与 `id` / `name` 都会保留（`--force` 是修配置，不是清配置）。
- 指向的必须是「含 `.git` 且 `git rev-parse --show-toplevel` 等于自身」的目录 —— 软链 / junction 不算。
- 改完核对：`gd-core core status` 看「仓库」一行；`gd-core core doctor` 里「代码仓绑定（repo）」应为 ✅
  （路径不存在 / 不是仓根 ⇒ ✗，缺这一行 ⇒ ⚠）。
- `repo:` 是**顶格**键，不是 `board:` 的子键 —— 缩进错位会读不到，报错会说「没记 repo」。

## 3. 多会话并行

见 `references/workflow.md` §5。要点复述：

```bash
export GD_EXECUTOR=w2              # 本会话身份
gd-core work next --claim          # 领下一个（我的线优先 → 我线上 ready → 未认领线 ready）
gd-core work list                  # 谁在干什么
```

- 账互斥（锁 + 租约 + 乐观锁重放）+ 代码隔离（worktree + 串行 `--ff-only` 合入），**两件都要**。
- 租约 15 分钟无心跳即自动可接管（接管留痕），不会把任务锁死。
- 别人开发线的活别领（领了会被闸门拒）。
- 更细的人读手册（开工会话 / 冲突处置 / 结版 / 账救援）：完整 CLI 仓的 `docs/gd-parallel-dev-guide.md`。

## 4. 归档

里程碑 / 版本收口时，明细进归档文档；`roadmap.md` 只留当前视图（`gd core roadmap --write` 重算）。

# 进度视图、备份与跨机、多会话

## 1. 视图

```bash
gd-core core roadmap            # 打印三层账渲染出的 markdown
gd-core core roadmap --write    # 写回 roadmap.md 的 <!-- gd:board-view --> 标记块（幂等）
```

- **手改视图不产生任何派生态**；视图随时可由账重算。
- 完成度、未完成任务、版本/子版结版态都从账算出来，不需要人工维护第二份。

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

## 3. 多会话并行

见 `references/workflow.md` §5。要点复述：

```bash
export GD_EXECUTOR=w2              # 本会话身份
gd-core work next --claim          # 领下一个（我的线优先 → 我线上 ready → 未认领线 ready）
gd-core work list                  # 谁在干什么
```

- 账互斥（锁 + 租约 + 乐观锁重放）+ 代码隔离（worktree + 串行 `--ff-only` 合入），**两件都要**。
- 租约 15 分钟无心跳即自动可接管（接管留痕），不会把任务锁死。
- 别人版本线的活别领（领了会被闸门拒）。
- 更细的人读手册（开工会话 / 冲突处置 / 结版 / 账救援）：完整 CLI 仓的 `docs/gd-parallel-dev-guide.md`。

## 4. 归档

里程碑 / 版本收口时，明细进归档文档；`roadmap.md` 只留当前视图（`gd core roadmap --write` 重算）。

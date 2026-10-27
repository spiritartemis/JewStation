# 命令与参数（core 面）

> 命令里的 `gd-core`：装的是 core 包就用它；完整 CLI 环境等价 `gd`（族名相同）。
> 每条都支持 `--json`（机器读，含 `ok` 字段）——脚本化时优先用它，不要 grep 中文。

## core（板本身）

```bash
gd-core core init [--board-dir <路径>|--in-tree] [--id <板id>] [--name <名>] [--tag <tag>|--no-tag] [--force] [--dry-run]
gd-core core status
gd-core core roadmap [--write] [--out <文件>]
```

- `init` 缺省把板根放在 `<git-common-dir>/gdtwork`（worktree 共享、不进提交）；`--in-tree` 落仓根（账随代码同仓）。
- `init` 幂等：已有合法板 ⇒ 跳过、一个字节不改；`--force` 才重写配置（账件不动）。
- 缺省打基线 tag `core-base`（并行会话的共同出发点 + 一键回退锚）；`--no-tag` 不要。
- `roadmap --write` 只替换 `roadmap.md` 里的 `<!-- gd:board-view -->` 标记块，幂等。

## work（认领与隔离）

```bash
gd-core work claim <任务id> [--executor <名册id>] [--ttl <分钟>]   # ready → in_progress（租约 15 分钟）
gd-core work release <任务id> [--force]                            # 交还（释放租约）
gd-core work list                                                 # 谁在干什么
gd-core work start <任务id> [--base <ref>] [--worktree-dir <目录>]  # 建 worktree + task/<id> 分支
gd-core work submit <任务id> [--message "<提交信息>"]                # 精确路径提交 + rebase
gd-core work land <任务id> [--keep]                                # --ff-only 合入；默认回收工作区与分支
gd-core work next [--claim]                                        # 领下一个（我的线优先）
```

工作区缺省在 `<仓根>.wt/<任务id>`；`submit` 冲突即停并回滚 rebase，不搅别人工作区。

## 登账三族

```bash
gd-core milestone add "<名称>" --target <YYYY-MM-DD> [--alias <意涵缩写>] [--series <字母>] [--status planned|in_progress] [--req <需求id>]… [--note "…"]
gd-core milestone update <id> [--name "…"] [--target <YYYY-MM-DD>] [--status planned|in_progress] [--note "…"] [--ver <x.y|""]   # --ver：存量卡版号修正（设 / 清空）
gd-core req new "<标题>" --line <开发线段> [--summary "…"] [--kind feature|bug|chore] [--severity …] [--found-in <版本>] [--force]
gd-core req new "<标题>" [--ver <x.y>] …           # 旧口径：版本线索；[--subver x.y.z] 存量：id 仍为 R-<板>-NNN
gd-core task add <需求id> --task "[执行体id:]标题"… [--force]
```

## 流转两族

```bash
gd-core handoff <任务id> [--done "…"]… [--remain "…"]… [--decision "…"] [--next "…"] [--artifact <件>]… [--status in_progress|review]
gd-core check <任务id> --pass | --reject "原因" [--by <验收人>] [--note <结论>]
```

- `handoff` 是**交件**，认领是 `work claim`——纯接手别用 handoff（它不带租约、不可被接管）。
- **有 done 无 remain ⇒ 一次到位进 `review`**（合法流转表含 `ready → review`）；交件必带 `--done`/`--remain` 至少一项，空交件拒。
- 未派（`executor` 空）不可交件；他人持有且租约未过期 ⇒ 拒（等过期 / `work release` / `--force` 接管留痕）。

## 结版与版本线

```bash
gd-core ver list                                     # 子版清单：完成度（派生） + 结版态（宣告）
gd-core ver reach <x.y.z> --confirm <x.y.z> [--on <YYYY-MM-DD>] [--note "…"] [--force]
gd-core ver reopen <x.y.z> --confirm <x.y.z> --reason "…"
gd-core ver claim <x.y> [--as <名字>] [--note "…"] [--force]      # 认领版本线（谁负责这条 x.y）
gd-core ver release <x.y> [--as <名字>] [--force]
gd-core ver lanes                                     # 版本线清单（归属 + 子版 + 结版态）
```

## 读面（看板 / 查任务 / 查需求 / 看进度）

```bash
gd-core board [--events <n>]                          # 看板：4 态泳道 + 最近事件
gd-core task list [--req <需求id>] [--status <s>]… [--todo | --to-check]
gd-core task show <任务id> [--req <需求id>]            # input / 交付件 / 事件 / 可流转 / 下一步
gd-core req status <需求id>                           # 归属 / 子版结版态 / 版本线 / 任务 4 态
gd-core milestone progress [<id|alias>]                # 与 roadmap 派生视图同源
```

- 五个都是**纯读**：不写账、不提交；`milestone progress` 与 `gd core roadmap` 同源聚合，数字不会打架。
- `task show` 的「下一步」只给 core 面命令（`work claim` / `handoff` / `check`）——席位命令在 core 包里不存在，指了也没用。
- 落点只认板：无板（哪怕本机注册表里有项目）一律指路 `core init` / `GD_BOARD`，**不回落注册项目账**。

## 属于完整 CLI 的（core 面会 exit 2 指路）

`milestone list|update|reach|reopen` · `req update|apply|list` · `task gen|update` · `seat *` · `station *` ·
`proj *` · `agents *` · `dispatch` · `sync` · `git *`。

要这些能力：装完整 CLI（总控仓）或 `GD_MAIN_LOCAL=<总控仓根>` 后由 `gd-core` 转交。

## 三个高频参数

| 参数 | 语义 |
|---|---|
| `--board` | 兼容别名；板上命令**缺省就落本仓的板**，一般不用写 |
| `--project <项目id>` | 明确要动**注册项目账**（`projects/<name>/`）——属完整 CLI |
| `--confirm <值>` | 高危动作点名（结版 / 退档 / 账覆盖）；不写就被拒，这是故意的 |
| `--force` | 越过闸门（他人持有 / blocker 未清 / 配置重写）；会在账上留痕，别当默认 |

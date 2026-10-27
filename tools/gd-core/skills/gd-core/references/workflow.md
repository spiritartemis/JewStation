# 三层 workflow 与会话 SOP

## 1. 两轴账（开发轴：里程碑 → 需求 → 任务 · 发布轴：对外版本 → 需求成员）

| 层 | 命令 | 说明 |
|---|---|---|
| 里程碑 | `gd-core milestone add "…" --target <YYYY-MM-DD> --alias <意涵缩写>` | 开发线的载体（卡 id 铸 `m-1a`）；`alias` 只供人读检索，不参与排序 |
| 需求 | `gd-core req new "<标题>" --ver <x.y>` | 需求 ≡ 子版 1:1，id 自动 `R-<板>-<ver>-<子版号>`；**需求态由任务态派生**，不手改（`--subver x.y.z` 是存量口径，id 仍是 `R-<板>-NNN`，新需求别用） |
| 任务 | `gd-core task add <需求id> --task "local:<标题>"` | 底层；`local` = 板内名册的执行体（会话 / 人的手） |

编号规则：新模型需求 `R-<板id>-<线段>-<线内序号>`（如 `R-gm-1a-0`）· 旧模型 `R-<板id>-<版本段>-<子版号>` · 存量 `R-<板id>-001`；缺陷 `B-<板id>-<6位>`；任务 `T-<板id>-<线段>-<线内序号>-NN`。

**发布轴**（互不绑架）：`gd release new/list/show/add/freeze/tag` —— 版本号只在这里产生，成员表记「版本 ↔ 需求」（多对多，可 backport）。**开发线认领**：`gd line claim <线段> --as <名字>`（并行隔离）。

**进行中可多张**：里程碑 `status` 是账面真值，写什么就是什么——多张可同时 `in_progress`（并行里程碑合法）；不派生、不接棒，达成一张不会改写别人的状态。并行隔离靠版本线（`gd ver claim <x.y> --as <名字>`）。

**登记顺序（别踩坑）**：建需求后**立刻**挂到里程碑 / 子版，再拆任务——需求一旦全任务完成就进终态，之后再挂会被达成判据挡住（历史上真出过「无里程碑的孤儿需求」）。

## 2. 干一个任务的全链

```bash
gd-core work claim <任务id>        # 认领 = 这个动作：ready → in_progress，写占用租约（15 分钟，动账自动续期）
gd-core work start <任务id>        # 开隔离工作区：worktree + task/<任务id> 分支（主工作区零污染）
cd <工作区路径>                    # 在里面改代码
gd-core work submit <任务id>       # 精确路径提交 + rebase 到基线（冲突即停并回滚 rebase）
gd-core work land <任务id>         # 串行 --ff-only 合入基线，默认回收工作区与分支
gd-core handoff <任务id> --done "<已做>" --artifact <件>   # 交件：有 done 无 remain ⇒ 一次到位进 review
gd-core check <任务id> --pass --note "<结论>"              # 验收：review → done
gd-core check <任务id> --reject "<原因>"                   # 打回：review → in_progress，原因入账
```

**闸门（别想抄近路）**：
- 未 `start` 不能 `submit`，未 `submit` 不能 `land`；
- `handoff --status done` 当场拒 —— 完成只能由 `check --pass` 产生；
- `check --pass` 只对 review 态生效；
- 别人持有的任务不能 `start`（租约过期才可接管，接管留痕）。

**交件的三条闸门（0.24.2 R-gm-087，别踩）**：
- **认领只归 `work claim`**：`handoff` 不再兼任认领——纯接手 / 只是宣告「我接手了」就走 `work claim`（它才有占用租约、才可被接管）。`handoff` 必须带 `--done` 或 `--remain` 至少一项，空交件当场拒；
- **未派不可交**：`executor` 空（没有承接方）的任务不能交件 —— 先定承接方（板面拆任务时带前缀 `local:标题`；席位面 `gd seat task dispatch`）；
- **他人占用拒**：任务正被别的会话持有且租约未过期 ⇒ 交件拒。等租约过期（无心跳自动可抢）· 让持有者 `work release` · 确需接管加 `--force`（原持有者会记进事件）。

**交件一次到位**：有 `done` 无 `remain` 直接进 `review`（合法流转表含 `ready → review` 的交件合一跃迁）。
旧口径「首次 handoff 只到 in_progress」已废——它会让 done / 交付件 / 事件**已经入账**、状态却还停在处理中，验收方按 `--to-check` 蹲不到单子，容易被误判成「没交件」。

**只做了一半**：只跑 `submit` 不跑 `land`，改动留在工作区里等下次接着做。

## 3. 交件四要素

`handoff` 的账字段：`done`（做成了什么，**可多次**）/ `remain`（还差什么，可多次）/ `decision`（为什么这么定，单值）/ `next`（下一步给验收的话，单值）。
`--decision` / `--next` 一次只给一条（重复给会被解析成空值）——多处取舍就合成一段写完。
`--artifact <件>` 会算指纹（sha256）入账 —— 交付事实与宿主无关，属 core。

### 3.1 证据充分性（软建议 · 不是闸门）

**前提**：验收人常常是**另一个会话**——它不共享干活时的上下文，只看得见「账 + 代码」。
所以「A 做、B 验」能不能独立成立，全靠交件时往账上放了什么；`check --pass` 不检查交件质量，这一条靠自觉。

交件侧（做的那个）自检：

| 要素 | 够用的写法 |
|---|---|
| `done` | 每条都能对上需求判据 / 任务口径，不写「已改好」 |
| `--artifact` | 改动落在哪些文件 / 目录就带哪些（指纹可复算） |
| `decision` | 取舍理由、被排除的做法、**隐含假设**——验收人最容易缺的就是这一段 |
| `next` | 明确告诉验收人往哪看、跑什么 |
| 顺序 | 先 `land` 再交件；只 `submit` 的改动还在 `.wt/<任务id>`，验收人看到的是未入基线的状态 |

验收侧（验的那个）走法：读任务账 → 对判据逐条核 → 复算交付件指纹 → 重跑门禁 / 回归 → `check --pass --note`；
证据不够就 `check --reject "<缺什么>"`（回 `in_progress`、原因入账）。

**别把「读不懂对方的意图」记成「对方没做完」**：先看 `decision` 段有没有写——缺了按证据不足 reject 要求补齐，比猜着 pass 便宜。

## 4. 两个概念别混

- `executor` = 负责人（长命、进账、板内名册里的名字）
- `claim` = 此刻谁在干（短命、带租约）

会话重启不丢「谁负责」；进程被 kill 也不会把任务锁死（租约过期即可被接管）。

## 5. 多会话并行：两件都要

账互斥（锁 + 租约 + 乐观锁重放）与代码隔离（worktree + 串行合入）**必须同时有**——
只做前者会出现「账不冲突，但两个人同时改同一个文件」。

```bash
export GD_EXECUTOR=w2      # 本会话身份（缺省 = 板默认执行体；名字只影响归属与审计）
gd-core ver claim 0.22 --as w2     # 认领版本线（我的地盘；别人动这条线会被拒）
gd-core work next --claim          # 领下一个任务（我的线优先；没有则回报池空）
gd-core work start <任务id>
```

`gd-core work next` 的挑选顺序：**我名下未过期的续作 → 我线上的 ready → 未认领线的 ready**；
派给别人的活不抢，他人版本线的活不领（领了也会被闸门拒）。

## 6. 结版是宣告，完成度是事实

```bash
gd-core ver list                              # 每条子版：完成度（派生） + 结版态（人的宣告）
gd-core ver reach <x.y.z> --confirm <x.y.z>   # 结版（须点名，铁律）
gd-core ver reopen <x.y.z> --confirm <x.y.z> --reason "<为什么之前的宣告有误>"
```

- **完成度**由需求状态派生；**结版**是人的宣告 —— 两件事分开显示，别混。
- `reopen` 的语义是「我之前的宣告有误」（漏了需求 / 验收结论被证伪），**不是**「又发现了 bug」——后者开新子版。
- 结版前若有未完成的 blocker 缺陷，会被门禁拦住（`--force` 才能越过，且要留痕）。

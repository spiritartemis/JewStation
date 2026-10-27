# brief 契约（`brief_version: 1`）

> 权威源：`scripts/lib/brief.mjs`（取数与判据）+ `scripts/core-brief.mjs`（参数与出口）。
> 本文只讲**消费方怎么读**，不改口径；实现细节与代码不一致时以代码为准。

## 顶层

| 字段 | 类型 | 说明 |
|---|---|---|
| `ok` | bool | 恒 true（出错走 exit 1 + stderr，不返回半份契约） |
| `brief_version` | int | 契约版本。**字段增删要升它**，消费方按版本判断 |
| `generated_at` | ISO8601 | 取数时刻 |
| `board` | `{id, name, mode, executors[]}` | `mode` = `session`（会话语义）或 `seat`（席位语义） |
| `session` | string | 本会话短号（`PI_SESSION_ID` / `GD_SESSION` / `pid-<pid>` 降级链） |
| `coords` | object\|缺省 | 见下 |
| `map` | object\|缺省 | 见下 |
| `recent` | array\|缺省 | 见下 |
| `next` | array\|缺省 | 见下 |
| `drift` | array\|缺省 | 见下 |

`--section <名>` 单取时，**未取到的段整个不出现**（不是空数组、不是 null）。

## coords（我在哪）

五级降级，每级都来自账，不猜：

| 级 | 判据 |
|---|---|
| 1 | 本会话持有、租约未过期的 `in_progress` 任务 |
| 2 | `review` 状态任务（待验收） |
| 3 | `ready` 且依赖已满足的任务（按子版 → id 排序） |
| 4 | 活跃里程碑的版号上最早的未结版子版，取其未完成需求 |
| 5 | 全板最早未完成需求 |

```jsonc
{
  "milestone": { "id": "m-4", "alias": "req-order", "name": "…", "status": "in_progress",
                 "target": "2026-10-25", "days_left": 0, "overdue_days": 0 },
  "version":   { "alias": "0.49", "claimed_by": "local", "is_mine": true },
  "subver":    { "alias": "0.49.1", "closed": false, "reqs_done": 0, "reqs_total": 1 },
  "req":       { "id": "R-gm-49-1", "title": "…", "status": "ready", "subver": "0.49.1" },
  "task":      { "id": "T-gm-49-1-01", "title": "…", "status": "in_progress",
                 "executor": "local", "held_by_me": true }
}
```

任一级定位不到 ⇒ 该字段为 `null`（不是空对象）。

## map（鸟瞰）

```jsonc
{
  "totals": { "reqs": 161, "reqs_done": 156, "tasks": 408, "tasks_done": 394 },
  "milestones": [
    // 已达成且非 --full ⇒ 折叠：只有三个数 + collapsed:true，没有 versions / open_reqs
    //   （JSON 档**不漏张**：所有里程碑都在里面，折叠只发生在文本档的渲染上）
    { "id": "m-1", "status": "reached", "reached_on": "2026-10-23",
      "reqs_done": 84, "reqs_total": 84, "collapsed": true },
    { "id": "m-4", "status": "in_progress", "ver": "0.40",
      "reqs_done": 23, "reqs_total": 28, "tasks_done": 61, "tasks_total": 75,
      "collapsed": false,
      "versions": [ /* 见下 */ ],
      "versions_closed": 9, "versions_total": 11,
      "open_reqs": [ { "id": "R-gm-48-0", "title": "…", "status": "ready", "subver": "0.48.0" } ],
      "missing_reqs": [] }
  ]
}
```

**版本瘦身规则**：非 `--full` 时 `versions[]` **只含还没结版的版本**（+ 该版号上还没开工的空位）；
已结版版本只计数（`versions_closed` / `versions_total`）。原因：全量展开实测让 `map` 段涨到 13 KB，
把整个 JSON 顶破 16 KB 预算。

**文本档的折叠规则**（只影响渲染，不影响 JSON）：鸟瞰一行一张里程碑，格式
`<✅|▸> id  别名  定位（名称，超 30 字截断）  需求 done/总`（不用竖线，列按显示宽度对齐；版号不进表）；
已达成超过 `MAX_REACHED_ROWS`（4 张）时**优先隐藏结版时间最早的**，折掉几张在段首下一行点名，
段首那行始终给全板三组计数（里程碑 achieved/总 · 需求 · 任务）——被折掉的不是黑洞。

单个版本：

```jsonc
{ "alias": "0.48", "planned": false, "status": "in_progress" /* done | in_progress | unplanned */,
  "reqs": 3, "reqs_done": 0, "tasks": 9, "tasks_done": 0, "closed": false,
  "subvers": [ { "alias": "0.48.0", "closed": false, "reqs_done": 0, "reqs_total": 1 } ] }
```

- `planned: true` = 里程碑有版号、但该版本还没排活（**不是欠账**）
- `closed` = 其下子版全部已结版

## recent（上次干到哪儿）

事件流倒序，**同一任务的连续事件合并**，`note` / `context` 类工单元数据事件已过滤。
**只留最近 3 条**（`RECENT_ROWS`）——流水账越长越没人看；文本档每条一行、列按显示宽度对齐
（时间 / 对象 / 事件 / 说明，无表头行），且排在**最末一段**。

```jsonc
{ "at": "2026-10-25T02:38:00Z", "kind": "review", "kinds": ["review", "handoff"],
  "task": "T-gm-B000037-02", "req": "B-gm-000037", "state": "pass", "text": "T-02 回归通过：…" }
```

`kinds` 是**倒序合并**的全部种类；`kind` 是其中最"晚"的一条。

## next（下一步）

按优先级排序，最多 3 条：

| rank | why | 判据 | cmd 形态 |
|---|---|---|---|
| 1 | 你手上的占用（续作） | 本会话租约内的 `in_progress` | `gd work start <id>` |
| 2 | 待你验收 | `review` | `gd check <id> --pass` |
| 3 | 可开工 | `ready` 且依赖全 `done` | `gd work claim <id> && gd work start <id>` |
| 4 | 子版待结版（要人拍） | 子版下需求全验收但未结版 | `gd ver reach x.y.z --confirm x.y.z` |
| 5 | 需求未拆任务 | 未终态需求零任务 | `gd task add <rid> --task "…"` |

```jsonc
{ "rank": 3, "why": "可开工（依赖已满足）",
  "target": { "kind": "task", "id": "T-gm-48-0-01", "title": "…" },
  "cmd": "gd work claim T-gm-48-0-01 && gd work start T-gm-48-0-01" }
```

`target.kind` ∈ `task` / `subver` / `req`；`kind: subver` 时 `title` 为 `null`（id 已自解释）。

## drift（账上的矛盾）

```jsonc
{ "code": "REQ_ON_CLOSED_SUBVER", "level": "warn", "count": 1,
  "text": "R-gm-47-11 挂在已结版子版 0.47.11 上，但状态仍是「ready」",
  "items": [ { "id": "R-gm-47-11", "text": "…", "cmd": "gd req status R-gm-47-11" } ],
  "cmds": ["gd req status R-gm-47-11"], "more": 0 }
```

一条 rule 一行 `text`（同类多条合并成 id 列表）；`items[]` 给逐条明细（最多 5 条，`more` 是剩下的数量）。
排序：`warn` 在前，同级按 `code` 字母序（**稳定可比**）。

### code 全表

| code | level | 判据 | 建议命令 |
|---|---|---|---|
| `VER_UNCLAIMED` | warn | 版本线有未结版需求，`lanes.yaml` 无该版本归属 | `gd ver claim <x.y>` |
| `REQ_ON_CLOSED_SUBVER` | warn | 需求挂在已结版子版上、状态非终态 | `gd req status <rid>` |
| `REQ_VERSION_IN_RANGE` | warn | 需求子版落在某里程碑的版号上，却没挂那张里程碑 | `gd milestone update <m> --req-add <rid>` |
| `CLAIM_EXPIRED` | warn | 占用租约已过期（非 done 任务） | `gd work claim <tid>` |
| `DONE_WITH_CLAIM` | warn | `done` / `review` 却仍带占用 | `gd core doctor --fix` |
| `UNPUSHED_COMMITS` | warn | 主仓有未推送提交；**无 upstream 时整项不出现** | `git push` |
| `DIRTY_MAIN` | info | 主树有未提交改动 | `git status --short` |
| `REQ_NO_TASK` | info | 未终态需求零任务 | `gd task add <rid> --task "…"` |
| `SUBVER_READY_UNCLOSED` | info | 子版需求已全验收但未结版（结版要人拍） | `gd ver reach x.y.z --confirm x.y.z` |

**「无假字段」判据**：拿不到的事实整项不出现。`UNPUSHED_COMMITS` 在没有 upstream 时**不报 0**
（0 会把人骗成"已推送"）；`--no-git` 时两条 git 类判据一起消失。

## 消费约定

- 机器面优先读 `code` / `rank` / `collapsed` 这类**结构性字段**，别匹配中文文案（文案会改）。
- `--json` 超 16 KB 时命令 **exit 1 并指路 `--section`**（不静默截断）。
- 文本档的着色只在 TTY 生效；管道/重定向自动无色，可直接解析。

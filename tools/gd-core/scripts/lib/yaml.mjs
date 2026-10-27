/**
 * 极简 YAML 解析器（gd 配置子集）
 *
 * 支持：2 空格缩进层级、`key: value`、`key:`（空值 → **null**；有子块则为对象）、列表项 `- key: value` / `- value`、
 *     字面块标量 `|`（task-list input 等多行值）、行内注释。
 * 覆盖文件：projects/_registry.yaml、blueprint/manifest.yaml、gd.config.yaml、reqs/*.yaml。
 * 不覆盖：数组缩进嵌套、引号转义、块风格折叠（>）等复杂标量 —— gd 配置不用。
 */

/**
 * 去掉行内注释（`#` 前须有空白，避免误伤值内 #；值以 # 开头视为纯注释 → 空）。
 * 引号感知：引号对内的 ` #` 不算注释（否则 `title: "a # b"` 会被截断且引号失衡）。
 */
function stripComment(v) {
  const t = v.trimStart();
  if (t.startsWith("#")) return "";
  let quote = null;
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "#" && i > 0 && /\s/.test(v[i - 1])) return v.slice(0, i).trim();
  }
  return v.trim();
}

/**
 * 标量解析：剥注释后，**内联数组** `[a, b]` / `[]` → 真数组（0.11.0）· **空 flow mapping** `{}` → 空对象（0.17.0）；其余原样（字符串）。
 *   内联数组来源：席位表 `capability_face: [规律, 数值]` 与 `seat_workers[].capability_face` 需为数组才能参与路由
 *   （`lib/seatworker.mjs`）；空对象来源：策略/清单里的 `overlays: {}` 这类"显式留空"——曾因回字符串被
 *   `Object.entries("{}")` 拆成 `{0:"{",1:"}"}` 两个幽灵条目。
 * 未支持嵌套数组（`[[a]]`）与非空 flow mapping（`{a: 1}`）——本仓无此形态。
 */
function parseScalar(v) {
  const s = stripComment(v);
  const m = /^\[(.*)\]$/.exec(s);
  if (m) {
    const inner = m[1].trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x !== "")
      .map((x) => x.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1"));
  }
  // 与 `[]` 同口径；非空 `{a: 1}` 仍不支持（本仓无此形态）
  if (s === "{}") return {};
  return s;
}

/**
 * 空容器的收尾（0.18.6）：弹出时若仍**一个子键都没填**，回填 `null`（YAML 空标量语义）。
 * 为什么必须这样：消费方普遍写 `v ? String(v) : null`——`{}` 是 truthy ⇒ 会变 `"[object Object]"`，
 *   再写盘就把坏值固化（真机事故的根部）。
 * 只处理**由 `key:` 空值压栈的对象容器**：根与列表项都不带 `parent`，一律跳过。
 */
function collapseEmpty(el) {
  if (!el?.parent || Array.isArray(el.parent)) return;
  if (Object.keys(el.node).length === 0) el.parent[el.key] = null;
}

/** 字面块（|）值收尾：去首尾空行（中间空行保留），再以换行连接 */
function trimBlockValue(lines) {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a] === "") a++;
  while (b > a && lines[b - 1] === "") b--;
  return lines.slice(a, b).join("\n");
}

/**
 * 字面块（|）落值：按块内**最小**内容缩进统一切齐后收尾。
 * 不用「首个非空行的缩进」（首行偏大 ⇒ 后续行被多切一块，正文静默截断）。
 */
function finalizeBlock(block) {
  const indents = block.lines.filter((l) => l.trim() !== "").map((l) => l.match(/^ */)[0].length);
  const cut = indents.length > 0 ? Math.min(...indents) : 0;
  block.parent[block.key] = trimBlockValue(block.lines.map((l) => (l === "" ? "" : l.slice(Math.min(cut, l.length)))));
}

/**
 * 顶层同名键检测：只扫**缩进为 0** 的 `key:` 行——字面块（`|`）的内容行缩进必 > 0，
 * 故不会把块内文本误判为键。用途：本解析器同名键**后者覆盖**（静默丢内容），写侧若按「第一个同名键」落笔
 * 就与读侧错位（实测事故：交货单双 `note:` 块 ⇒ CLI 备注每次白写）；`gd contract check` C5 与写路径据此报警。
 * @param {string} text
 * @returns {{key: string, lines: number[]}[]} 出现 ≥2 次的键（含各自 1-based 行号，按首次出现顺序）
 */
export function findDuplicateTopKeys(text) {
  const seen = new Map();
  const rows = String(text).split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    if (!line || line.startsWith("#") || /^[ \t]/.test(line)) continue; // 空行/注释/非顶层
    const m = /^([A-Za-z_][A-Za-z0-9_.-]*):(.*)$/.exec(line);
    if (!m) continue;
    if (!seen.has(m[1])) seen.set(m[1], []);
    seen.get(m[1]).push(i + 1);
  }
  return [...seen.entries()].filter(([, l]) => l.length > 1).map(([key, lines]) => ({ key, lines }));
}

/**
 * 解析 YAML 文本为对象树。
 * @param {string} text
 * @returns {object}
 */
export function parseYaml(text) {
  const root = {};
  /** 栈元素：{ indent, key, node } —— node 为当前层对象或数组 */
  const stack = [{ indent: -1, key: null, node: root }];
  /** 字面块标量状态（`key: |`）：{ indent, key, parent, lines } —— lines 存原始行，落值时统一按最小缩进切齐 */
  let block = null;

  for (const raw of text.split(/\r?\n/)) {
    // ── 字面块（|）续行：内容行原样累积；首个缩进 ≤ 键缩进的非空行终止块（该行回落常规处理） ──
    if (block) {
      const ind = raw.match(/^ */)[0].length;
      if (raw.trim() === "") {
        block.lines.push("");
        continue;
      }
      if (ind <= block.indent) {
        finalizeBlock(block);
        block = null;
      } else {
        block.lines.push(raw);
        continue;
      }
    }

    const t = raw.trim();
    if (!t || t.startsWith("#")) continue;

    const indent = raw.match(/^ */)[0].length;

    // 弹出缩进 ≥ 当前行的祖先（缩进变小或相等 → 回到父级）
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) collapseEmpty(stack.pop());
    const parent = stack[stack.length - 1];

    if (t.startsWith("- ")) {
      // ── 列表项 ──
      // 确保父级为数组（首个列表项时把父级对象转数组，父级必然挂在栈更上层）
      if (!Array.isArray(parent.node)) {
        const arr = [];
        const grand = stack[stack.length - 2];
        if (grand && parent.key !== null) grand.node[parent.key] = arr;
        parent.node = arr;
      }
      const item = t.slice(2).trim();
      const m = item.match(/^([^:]+):\s*(.*)$/);
      if (!m) {
        // 纯值列表项
        parent.node.push(parseScalar(item));
        continue;
      }
      const key = m[1].trim();
      const val = m[2].trim();
      const obj = {};
      parent.node.push(obj);
      if (val !== "") obj[key] = parseScalar(val);
      // 列表项对象压栈，承接更深缩进的子字段（如 capabilities 下 - id: xxx 的子字段）
      stack.push({ indent, key, node: obj });
      continue;
    }

    // ── 普通键值 ──
    const m = t.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim();
    const clean = stripComment(val); // 此处仅用于判断「是否为空值 / 字面块」（容器与块标量不可能是内联数组）
    if (clean === "|") {
      // 字面块标量（|）：键值为空字面块，内容从下行起（缩进须大于键缩进；终止行回落常规处理）
      block = { indent, key, parent: parent.node, lines: [] };
      continue;
    }
    if (clean === "") {
      // 空值（含纯注释）：**先当一个可能的容器压栈**，到弹出时仍未填任何子键 ⇒ 回填 `null`
      //   （0.18.6 修：以前空值一律落 `{}`，而消费方写 `key ? String(key) : null` 会把 `{}` 变 "[object Object]"——
      //    真机事故：成员链接被吊销（token 置空）→ 下次读回成 "[object Object]" → 再写盘就固化成坏令牌，且全静默）
      const obj = {};
      parent.node[key] = obj;
      stack.push({ indent, key, node: obj, parent: parent.node });
    } else {
      parent.node[key] = parseScalar(val);
    }
  }

  // 文件尾仍有未终止的字面块 → 落值（无内容行则为空串）
  if (block) finalizeBlock(block);
  // 文件尾仍未填子键的空容器 → 回填 null（与中途弹出同口径）
  while (stack.length > 1) collapseEmpty(stack.pop());

  return root;
}

/**
 * 剥标量首尾成对引号（本仓解析器不剥引号，消费方据此归一）；非字符串返回 ""。
 * 双引号形按 JSON 解转义（写方 `JSON.stringify` 的含引号值据此还原），单引号形剥引号。
 * 单一事实源：能力声明与能力索引的消费方（agent-capabilities / manifest / gd agent find）+
 *   席位本机配置 `seat.config.yaml` 的消费方（`templates/seat/bin/seatrun.mjs` / `gd seat doctor`）共用。
 */
export function unquoteScalar(v) {
  if (typeof v !== "string") return "";
  const t = v.trim();
  // 双引号形：写方 `JSON.stringify` ⇒ 按 JSON 解转义还原（length ≥ 2 排除落单引号）
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t);
    } catch {
      /* 非合法 JSON 字面量（如 `"a" "b"`）→ 退化为剥壳 */
    }
  }
  return t.replace(/^["']+|["']+$/g, "");
}


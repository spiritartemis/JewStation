/**
 * 终端着色— CLI 人读输出统一色板 + 探测规则（单一事实源）
 *
 * 用法：
 *   import { out, errOut } from "./lib/style.mjs";      // scripts/*.mjs
 *   import { out, errOut } from "./style.mjs";          // scripts/lib/*.mjs
 *   console.error(errOut.err(`✗ 非法流转：${...}`));    // stderr + 红
 *   console.log(out.warn(`  ⚠ 未落盘：${...}`));        // stdout + 黄
 *   console.log(out.ok(`✅ 任务流转：${...}`));          // stdout + 绿
 *
 * 色板（对齐 protocol.md §3.5 人读输出约定）：
 *   ✗ 失败 → 红 · ⚠ 警告 → 黄 · ✅ 成功 → 绿 · dim → 次要信息（灰）
 *   **整条着色**（不是只染标记）；表格/清单类行的标记单元格按需只染标记本身。
 *
 * 探测规则（流级别判定，与写入流一致）：
 *   1. FORCE_COLOR 非空且非 "0" → 强制着色（测试 / 分页器场景；显式强制优先）
 *   2. NO_COLOR **非空** → 关闭（按 no-color.org 规范：present and not an empty string）
 *   3. TERM=dumb → 关闭
 *   4. 否则看该流 isTTY（管道 / 重定向自动无色 —— producer 与 skill 解析 CLI 文本因此安全）
 *
 * 边界（硬约束）：
 *   · `--json` / 机器可读输出**绝不着色**（JSON 解析方不容 ANSI 转义）；
 *   · 写盘内容（git hook 脚本、模板渲染、YAML/Markdown）**绝不着色** ——
 *     着色只作用于「终端展示行」，不作用于「产生的内容」。
 */
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/** 该流是否应着色（见文件头探测规则） */
export function supportsColor(stream = process.stdout) {
  const force = process.env.FORCE_COLOR;
  if (force !== undefined && force !== "0" && force !== "") return true;
  if (process.env.NO_COLOR) return false;      // 规范：非空即关（空串不关）
  if (process.env.TERM === "dumb") return false;
  return !!stream?.isTTY;
}

/**
 * 造一个绑定到某输出流的着色器。
 * @param {NodeJS.WriteStream} stream 该流的 isTTY 决定是否着色
 * @returns {{err:(s:string)=>string, warn:(s:string)=>string, ok:(s:string)=>string, dim:(s:string)=>string, enabled:boolean}}
 */
export function styler(stream = process.stdout) {
  const enabled = supportsColor(stream);
  const wrap = (code) => (s) => (enabled ? `${code}${s}${RESET}` : s);
  return { err: wrap(RED), warn: wrap(YELLOW), ok: wrap(GREEN), dim: wrap(DIM), enabled };
}

/** stdout 着色器（console.log 用） */
export const out = styler(process.stdout);
/** stderr 着色器（console.error / console.warn 用） */
export const errOut = styler(process.stderr);

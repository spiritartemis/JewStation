/**
 * 通用命令行参数解析（gd CLI 用）
 *
 * 规则：`--key value` 或 `--flag`（布尔）；非 `--` 开头的归入 `_` 位置数组。
 * 重复键：声明为 multiKeys 的键可重复出现，收集为数组（v，供 --task 多值用）。
 */
import { errOut } from "./style.mjs";

/**
 * @param {string[]} argv 不含程序名/脚本名的参数列表
 * @param {string[]} [multiKeys] 支持重复收集为数组的键名
 * @returns {{ _: string[], [k: string]: string | boolean | string[] }}
 */
export function parseArgs(argv, multiKeys = []) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      const isMulti = multiKeys.includes(key);
      if (next !== undefined && !next.startsWith("--")) {
        if (isMulti) (args[key] = args[key] || []).push(next);
        else args[key] = next;
        i++;
      } else if (isMulti) {
        (args[key] = args[key] || []).push(true);
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

/**
 * 未知旗标收集（写错就拒，不静默忽略）：返回错误行，空数组 = 全都认识。
 * @param {object} args `parseArgs` 的结果
 * @param {string[]} allowed 认识的键名（不带 `--`）
 * @param {string} [label] 错误行前缀（如 `core 面不认识`）
 */
export function unknownFlags(args, allowed, label = "未知参数") {
  return Object.keys(args)
    .filter((k) => k !== "_" && !allowed.includes(k))
    .map((k) => `${label} --${k}`);
}

/** 参数校验失败的统一回显（`✗ 参数校验未通过：` + 逐条 + 用法），返回退出码 1 */
export function rejectArgs(errors, usage) {
  console.error(errOut.err("✗ 参数校验未通过："));
  for (const e of errors) console.error(`  · ${e}`);
  console.error(`用法：\n${usage}`);
  return 1;
}

/** 取必填参数，缺失时收集错误 */
export function requireArg(args, key, errors, hint) {
  const v = args[key];
  if (v === undefined || v === true) {
    errors.push(`缺少 --${key}${hint ? ` <${hint}>` : ""}`);
    return null;
  }
  return String(v);
}

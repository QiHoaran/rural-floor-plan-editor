// ============================================================
// ID 生成器 — 使用稳定的字符串ID格式
// ============================================================

type IdPrefix = 'v' | 'w' | 'd' | 'win' | 'r' | 'plan';

const counters: Record<IdPrefix, number> = {
  v: 0,
  w: 0,
  d: 0,
  win: 0,
  r: 0,
  plan: 0,
};

/**
 * 生成形如 "v_0001" 的字符串ID
 * @param prefix ID前缀
 * @returns 格式化的ID字符串
 */
export function generateId(prefix: IdPrefix): string {
  counters[prefix] += 1;
  return `${prefix}_${String(counters[prefix]).padStart(4, '0')}`;
}

/**
 * 设置计数器的起始值（用于导入Plan时恢复计数）
 */
export function setCounter(prefix: IdPrefix, value: number): void {
  counters[prefix] = Math.max(counters[prefix], value);
}

/**
 * 从已存在的ID中推断计数器最大值
 * 例如 "w_0042" → prefix "w", counter 42
 */
export function seedFromExistingIds(ids: string[]): void {
  for (const id of ids) {
    const match = id.match(/^([a-z]+)_(\d+)$/);
    if (match) {
      const prefix = match[1] as IdPrefix;
      const num = parseInt(match[2], 10);
      if (prefix in counters) {
        counters[prefix] = Math.max(counters[prefix], num);
      }
    }
  }
}

/**
 * 重置所有计数器（用于测试）
 */
export function resetCounters(): void {
  for (const key of Object.keys(counters) as IdPrefix[]) {
    counters[key] = 0;
  }
}

/**
 * 解析ID获取前缀和数字
 */
export function parseId(id: string): { prefix: IdPrefix; num: number } | null {
  const match = id.match(/^([a-z]+)_(\d+)$/);
  if (!match) return null;
  return { prefix: match[1] as IdPrefix, num: parseInt(match[2], 10) };
}

/**
 * 判断ID是否为有效的实体ID格式
 */
export function isValidId(id: string): boolean {
  return /^[a-z]+_\d{4}$/.test(id);
}

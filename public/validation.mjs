/** @param {unknown} value @returns {value is Record<string, unknown>} */
export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @template {object} T
 * @param {T} record
 * @param {unknown} key
 * @returns {key is Extract<keyof T, string>}
 */
export function hasKey(record, key) {
  return typeof key === 'string' && Object.hasOwn(record, key);
}

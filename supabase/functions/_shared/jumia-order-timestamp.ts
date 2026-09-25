export function formatJumiaOrderTimestamp(
  value: Date | number | string
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Cannot format an invalid Jumia order timestamp');
  }
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

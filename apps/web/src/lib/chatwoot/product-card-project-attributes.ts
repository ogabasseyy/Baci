import { isRecord } from './product-card-is-record';

const MAX_OPTION_KEY_LENGTH = 40;
const MAX_OPTION_VALUE_LENGTH = 80;
const ALLOWED_OPTION_KEYS = new Set([
  'capacity',
  'color',
  'colour',
  'configuration',
  'edition',
  'finish',
  'length',
  'material',
  'memory',
  'model',
  'ram',
  'size',
  'sim',
  'sim type',
  'storage',
  'style',
  'width',
]);

export function projectAttributes(
  value: unknown
): Record<string, string> | null {
  if (value == null) return {};
  if (!isRecord(value)) return null;
  const output: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (key.length > MAX_OPTION_KEY_LENGTH) return null;
    const cleanKey = key.trim().toLowerCase().replace(/[_-]+/g, ' ');
    if (!ALLOWED_OPTION_KEYS.has(cleanKey)) continue;
    if (Object.hasOwn(output, cleanKey)) return null;
    if (
      typeof rawValue !== 'string' ||
      rawValue.length > MAX_OPTION_VALUE_LENGTH
    ) {
      return null;
    }
    const cleanValue = rawValue.trim();
    if (cleanKey && cleanValue) output[cleanKey] = cleanValue;
  }
  return output;
}

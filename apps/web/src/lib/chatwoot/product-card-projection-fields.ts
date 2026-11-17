import { normalizeCanonicalProductCondition } from '@baci/shared/lib';

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_NAME_LENGTH = 120;
const MAX_OPTION_KEY_LENGTH = 40;
const MAX_OPTION_VALUE_LENGTH = 80;
const ALLOWED_CONDITIONS = new Set(['new', 'used', 'open_box']);
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function toPrice(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function toImage(value: unknown): string | undefined {
  const candidate =
    typeof value === 'string'
      ? value
      : isRecord(value) && typeof value.url === 'string'
        ? value.url
        : null;
  if (!candidate || candidate.length > 2_048) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:') return undefined;
    if (url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

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

export function normalizedCondition(
  value: unknown
): 'new' | 'used' | 'open_box' | undefined {
  if (typeof value !== 'string') return undefined;
  const condition = normalizeCanonicalProductCondition(value);
  return ALLOWED_CONDITIONS.has(condition)
    ? (condition as 'new' | 'used' | 'open_box')
    : undefined;
}

export function isPurchasableProduct(
  product: Record<string, unknown>
): boolean {
  const policy = product.effective_policy ?? product.inventory_tracking_policy;
  if (policy === 'serialized_then_unlimited') return true;
  const stock = parentEffectiveStock(product);
  if (policy === 'serialized_strict')
    return Number.isFinite(stock) && stock > 0;
  const manageStock =
    typeof product.manage_stock === 'boolean' ? product.manage_stock : true;
  return !manageStock || (Number.isFinite(stock) && stock > 0);
}

export function numericStock(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const stock = Number(value);
  return Number.isFinite(stock) ? stock : null;
}

export function parentEffectiveStock(product: Record<string, unknown>): number {
  const quantity = numericStock(product.stock_quantity);
  const legacyStock = numericStock(product.stock);
  if ((quantity ?? 0) <= 0 && (legacyStock ?? 0) > 0) {
    return Math.max(0, Math.trunc(legacyStock ?? 0));
  }
  return Math.max(0, Math.trunc(quantity ?? 0));
}

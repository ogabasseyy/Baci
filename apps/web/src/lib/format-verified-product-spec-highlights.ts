import type { ProductCategorySource } from './product-schema-spec-classification';
import { shouldIncludeProductSchemaSpec } from './product-schema-specs';

export type VerifiedProductSpecKey =
  | 'ram_gb'
  | 'storage_gb'
  | 'battery_mah'
  | 'main_camera_mp'
  | 'screen_size_inches'
  | 'refresh_rate_hz';

export interface FormatVerifiedProductSpecHighlightsInput {
  specs?: Record<string, unknown> | null;
  category?: string | null;
  categorySlugs?: string[] | null;
  keys?: readonly VerifiedProductSpecKey[];
  maxHighlights?: number;
}

const DEFAULT_SPEC_KEYS: readonly VerifiedProductSpecKey[] = [
  'ram_gb',
  'storage_gb',
  'battery_mah',
  'main_camera_mp',
  'screen_size_inches',
  'refresh_rate_hz',
];

const SPEC_FORMATTERS: Record<
  VerifiedProductSpecKey,
  (v: string | number) => string
> = {
  ram_gb: (v) => `${v}GB RAM`,
  storage_gb: (v) => `${v}GB storage`,
  battery_mah: (v) => `${v}mAh battery`,
  main_camera_mp: (v) => `${v}MP camera`,
  screen_size_inches: (v) => `${v}" display`,
  refresh_rate_hz: (v) => `${v}Hz refresh rate`,
};

function formatSpecValue(
  key: VerifiedProductSpecKey,
  value: string | number
): string {
  return SPEC_FORMATTERS[key]?.(value) ?? `${value}`;
}

function getPositiveNumericSpecValue(raw: unknown): string | number | null {
  if (typeof raw === 'number')
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed && /^\d+(\.\d+)?$/.test(trimmed) && Number(trimmed) > 0)
      return trimmed;
  }
  return null;
}

function isSpecEligible(
  key: VerifiedProductSpecKey,
  value: string | number,
  input: FormatVerifiedProductSpecHighlightsInput
): boolean {
  if (!input.category && !input.categorySlugs?.length) return true;
  const pSlug = input.categorySlugs?.[0];
  const rel = pSlug ? { name: pSlug, slug: pSlug } : null;
  const pks = input.specs as ProductCategorySource['product_key_specs'];
  const testCat = (c?: string | null, r = rel, s = pSlug) =>
    shouldIncludeProductSchemaSpec(
      {
        category: c ?? s ?? null,
        categories: r,
        category_slug: s ?? null,
        product_key_specs: pks,
      },
      { key, value }
    );
  if (!testCat(input.category)) return false;
  return (
    !input.categorySlugs ||
    input.categorySlugs
      .slice(1)
      .every((s) => testCat(s, { name: s, slug: s }, s))
  );
}

export function formatVerifiedProductSpecHighlights(
  input: FormatVerifiedProductSpecHighlightsInput
): string[] {
  const specs = input.specs;
  if (!specs || typeof specs !== 'object') return [];

  const keys = input.keys ?? DEFAULT_SPEC_KEYS;
  const maxHighlights = input.maxHighlights ?? 2;
  const highlights: string[] = [];

  for (const key of keys) {
    const val = getPositiveNumericSpecValue(specs[key]);
    if (val === null || !isSpecEligible(key, val, input)) continue;
    highlights.push(formatSpecValue(key, val));
    if (highlights.length === maxHighlights) break;
  }

  return highlights;
}

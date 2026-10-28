export const SNAPSHOT_CONDITIONS = [
  'New', 'Used', 'Open Box', 'New & Used', 'New & Open Box',
  'Used & Open Box', 'Multiple Conditions', 'new', 'used', 'open_box', 'refurbished',
] as const;
export type SnapshotCondition = (typeof SNAPSHOT_CONDITIONS)[number];
const SNAPSHOT_CONDITIONS_SET = new Set<string>(SNAPSHOT_CONDITIONS);

export const COMPARISON_SNAPSHOT_KEYS = [
  'id', 'name', 'price', 'image', 'description', 'brand', 'condition', 'slug',
  'merchantId', 'rawPrice', 'category', 'categorySlug', 'categories',
  'matchVariantId', 'matchOfferId', 'matchCondition',
] as const satisfies readonly (keyof ComparisonSnapshot)[];

const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

const OPTIONAL_STRINGS = ['brand', 'slug', 'merchantId', 'category', 'categorySlug'] as const;

export interface ComparisonSnapshotCategories {
  id: string;
  name: string;
  slug?: string;
}

export interface ComparisonSnapshot {
  id: string | number;
  name: string;
  price: string;
  image: string;
  description: string;
  brand?: string;
  condition?: SnapshotCondition;
  slug?: string;
  merchantId?: string;
  rawPrice?: number;
  category?: string;
  categorySlug?: string;
  categories?: ComparisonSnapshotCategories;
  matchVariantId?: string;
  matchOfferId?: string;
  matchCondition?: SnapshotCondition;
}

/** Zod-free equivalent of `comparisonSnapshotSchema.safeParse` for client bundles. */
export function parseComparisonSnapshot(value: unknown): ComparisonSnapshot | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;

  let id: string | number;
  if (typeof rec.id === 'string') {
    const trimmed = rec.id.trim();
    if (trimmed.length === 0) return null;
    id = trimmed;
  } else if (typeof rec.id === 'number' && Number.isFinite(rec.id)) {
    id = rec.id;
  } else return null;

  if (typeof rec.name !== 'string') return null;
  const name = rec.name.trim();
  if (name.length === 0) return null;

  if (typeof rec.price !== 'string' || typeof rec.image !== 'string' || typeof rec.description !== 'string') {
    return null;
  }

  const result: ComparisonSnapshot = { id, name, price: rec.price, image: rec.image, description: rec.description };

  for (const key of OPTIONAL_STRINGS) {
    if (key in rec) {
      const val = rec[key];
      if (val === undefined) result[key] = undefined;
      else if (typeof val === 'string') result[key] = val;
      else return null;
    }
  }

  for (const key of ['condition', 'matchCondition'] as const) {
    if (key in rec) {
      const val = rec[key];
      result[key] = typeof val === 'string' && SNAPSHOT_CONDITIONS_SET.has(val) ? (val as SnapshotCondition) : undefined;
    }
  }

  if ('rawPrice' in rec) {
    const val = rec.rawPrice;
    if (val === undefined) result.rawPrice = undefined;
    else if (typeof val === 'number' && Number.isFinite(val) && val >= 0) result.rawPrice = val;
    else return null;
  }

  for (const key of ['matchVariantId', 'matchOfferId'] as const) {
    if (key in rec) {
      const val = rec[key];
      result[key] = typeof val === 'string' && UUID_PATTERN.test(val) ? val : undefined;
    }
  }

  if ('categories' in rec) {
    const val = rec.categories;
    if (val === undefined) result.categories = undefined;
    else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      const catRec = val as Record<string, unknown>;
      if (typeof catRec.id !== 'string' || typeof catRec.name !== 'string') return null;
      const cat: ComparisonSnapshotCategories = { id: catRec.id, name: catRec.name };
      if ('slug' in catRec) {
        if (catRec.slug === undefined) cat.slug = undefined;
        else if (typeof catRec.slug === 'string') cat.slug = catRec.slug;
        else return null;
      }
      result.categories = cat;
    } else return null;
  }

  return result;
}

import {
  resetRefinementsForQuery,
  SEARCH_SORT_OPTIONS,
  type SearchAssistanceProposal,
  type SearchRefinements,
} from '@baci/shared/lib';

const UUID_RE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
const CONDITIONS = new Set(['new', 'open_box', 'used']);
const ERR = 'Check your filter values and price range';

function parseNumber(value: unknown, max: number): number | undefined {
  if (value == null) return undefined;
  // Match the shared zod contract: non-numeric types fail instead of
  // being silently dropped.
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(ERR);
  }
  const str = typeof value === 'number' ? String(value) : value.trim();
  if (!str) return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(str)) throw new Error(ERR);
  const num = Number(str);
  if (!Number.isFinite(num) || num < 0 || num > max) throw new Error(ERR);
  return num;
}

function parseText(val: unknown, max: number): string | undefined {
  if (val == null || val === '') return undefined;
  if (typeof val !== 'string') throw new Error(ERR);
  const trimmed = val.trim();
  if (trimmed.length < 1 || trimmed.length > max) throw new Error(ERR);
  return trimmed;
}

function parseUuid(val: unknown): string | undefined {
  if (val == null || val === '') return undefined;
  if (typeof val !== 'string' || !UUID_RE.test(val)) throw new Error(ERR);
  return val;
}

function parseCondition(val: unknown): 'new' | 'used' | 'open_box' | undefined {
  if (val == null || val === '') return undefined;
  if (!CONDITIONS.has(val as string)) throw new Error(ERR);
  return val as 'new' | 'used' | 'open_box';
}

export function mergeAssistedRefinementsClient(
  current: SearchRefinements,
  proposal: SearchAssistanceProposal,
  committedQuery: string
): SearchRefinements {
  const base = resetRefinementsForQuery(
    committedQuery,
    proposal.query,
    current
  );
  const next = { ...base, ...proposal.filters };
  const rawBrands = Array.isArray(next.brands)
    ? next.brands
    : next.brands != null
      ? [next.brands]
      : [];
  for (const b of rawBrands) {
    const s = typeof b === 'string' ? b.trim() : '';
    if (!s || b.length > 160) throw new Error(ERR);
  }
  const brands = [...new Set(rawBrands)].sort();
  if (brands.length > 50) throw new Error(ERR);

  if (Array.isArray(next.sort)) throw new Error('Choose one sort order');
  if (
    next.sort != null &&
    !SEARCH_SORT_OPTIONS.some((o) => o.value === next.sort)
  ) {
    throw new Error('Choose a valid sort order');
  }
  const sort = next.sort ?? 'relevance';

  const categoryId = parseUuid(next.categoryId);
  const condition = parseCondition(next.condition);
  const processor = parseText(next.processor, 80);
  const minPrice = parseNumber(next.minPrice, Number.MAX_SAFE_INTEGER);
  const maxPrice = parseNumber(next.maxPrice, Number.MAX_SAFE_INTEGER);
  const minRating = parseNumber(next.minRating, 5);
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    throw new Error(ERR);
  }

  return {
    processor,
    brands,
    sort,
    categoryId,
    condition,
    minPrice,
    maxPrice,
    minRating,
  };
}

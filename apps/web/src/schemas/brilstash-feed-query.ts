import { z } from 'zod';
import { BRILSTASH_HANDOFF_PAGE_LIMIT } from '../config/brilstash-feed';

const querySchema = z.strictObject({
  page: z.int().positive(),
  limit: z.int().min(1).max(BRILSTASH_HANDOFF_PAGE_LIMIT),
  min_price: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export type BrilStashFeedQuery = z.infer<typeof querySchema>;

// Local pilot defaults. Confirm wire bounds and NGN precision before publication.
export function parseBrilStashFeedQuery(
  params: URLSearchParams
): BrilStashFeedQuery | null {
  const values = { page: 1, limit: BRILSTASH_HANDOFF_PAGE_LIMIT, min_price: 0 };
  const seen = new Set<string>();

  for (const [key, value] of params) {
    if (seen.has(key)) return null;
    seen.add(key);

    switch (key) {
      case 'page':
      case 'limit':
        if (!/^\d+$/.test(value)) return null;
        values[key] = Number(value);
        break;
      case 'min_price':
        if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
        values.min_price = Number(value);
        break;
      default:
        return null;
    }
  }

  const parsed = querySchema.safeParse(values);
  if (!parsed.success) return null;
  const { page, limit } = parsed.data;
  return Number.isSafeInteger((page - 1) * limit) ? parsed.data : null;
}

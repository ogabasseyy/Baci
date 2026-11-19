import { z } from 'zod';
import { BRILSTASH_FULL_FEED_QUERY } from '../config/brilstash-feed';

const querySchema = z.strictObject({
  // The read RPC accepts a PostgreSQL integer page and computes the offset as bigint.
  page: z.int().positive().max(2_147_483_647),
  limit: z.int().min(1).max(BRILSTASH_FULL_FEED_QUERY.limit),
  min_price: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export type BrilStashFeedQuery = z.infer<typeof querySchema>;

// Local pilot defaults. Confirm wire bounds and NGN precision before publication.
export function parseBrilStashFeedQuery(
  params: URLSearchParams
): BrilStashFeedQuery | null {
  const values: BrilStashFeedQuery = { ...BRILSTASH_FULL_FEED_QUERY };
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
  return parsed.success ? parsed.data : null;
}

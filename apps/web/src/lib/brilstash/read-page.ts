import { createHmac } from 'node:crypto';
import type { z } from 'zod';
import { BRILSTASH_DB_READ_TIMEOUT_MS } from '../../config/brilstash-feed';
import type { BrilStashFeedQuery } from '../../schemas/brilstash-feed-query';
import { brilStashPageResultSchema } from '../../schemas/brilstash-page';
import { createAnonClient } from '../supabase/anon';

const UNAVAILABLE = { status: 'unavailable' } as const;
const DEADLINE = Symbol('BrilStash read deadline');
type PageReadResult =
  | z.infer<typeof brilStashPageResultSchema>
  | { status: 'deadline' | 'misconfigured' };

export async function readBrilStashPage(
  bearer: string,
  query: BrilStashFeedQuery
): Promise<PageReadResult> {
  const key = process.env.BRILSTASH_FEED_INGRESS_KEY;
  if (!key || !/^[a-f0-9]{64}$/.test(key)) {
    return { status: 'misconfigured' };
  }

  const issued = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', key)
    .update(`baci:brilstash-feed:v1:${issued}:${bearer}`)
    .digest('hex');
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const deadline = new Promise<typeof DEADLINE>((resolve) => {
      timeout = setTimeout(() => {
        resolve(DEADLINE);
        controller.abort();
      }, BRILSTASH_DB_READ_TIMEOUT_MS);
    });
    const resultOrDeadline = await Promise.race([
      createAnonClient()
        .rpc('read_brilstash_page', {
          p_bearer: bearer,
          p_page: query.page,
          p_limit: query.limit,
          p_min_price: query.min_price,
        })
        .setHeader('x-baci-brilstash-ingress', `${issued}.${signature}`)
        .abortSignal(controller.signal),
      deadline,
    ]);

    if (resultOrDeadline === DEADLINE) return { status: 'deadline' };
    const { data, error } = resultOrDeadline;
    if (error) return UNAVAILABLE;
    const result = brilStashPageResultSchema.safeParse(data);
    if (!result.success) return UNAVAILABLE;
    const page = result.data;
    if (page.status === 'ok') {
      // Sandbox pagination preserves the total headers even when the requested
      // offset has no rows. An empty assortment has its own zero totals.
      const expectedCount = Math.max(
        0,
        Math.min(query.limit, page.totalCount - (query.page - 1) * query.limit)
      );
      if (
        page.totalPages !== Math.ceil(page.totalCount / query.limit) ||
        page.products.length !== expectedCount
      )
        return UNAVAILABLE;
    }
    return page;
  } catch {
    return UNAVAILABLE;
  } finally {
    clearTimeout(timeout);
  }
}

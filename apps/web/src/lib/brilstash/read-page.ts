import { createHmac } from 'node:crypto';
import type { z } from 'zod';
import type { BrilStashFeedQuery } from '../../schemas/brilstash-feed-query';
import { brilStashPageResultSchema } from '../../schemas/brilstash-page';
import { createAnonClient } from '../supabase/anon';

const UNAVAILABLE = { status: 'unavailable' } as const;

export async function readBrilStashPage(
  bearer: string,
  query: BrilStashFeedQuery
): Promise<z.infer<typeof brilStashPageResultSchema>> {
  const key = process.env.BRILSTASH_FEED_INGRESS_KEY;
  if (!key || !/^[a-f0-9]{64}$/.test(key)) return UNAVAILABLE;

  const issued = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', key)
    .update(`baci:brilstash-feed:v1:${issued}:${bearer}`)
    .digest('hex');
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error('BrilStash read deadline'));
      }, 8000);
    });
    const { data, error } = await Promise.race([
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

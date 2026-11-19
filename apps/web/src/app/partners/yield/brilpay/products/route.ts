import { randomUUID } from 'node:crypto';
import {
  BRILSTASH_HANDOFF_PAGE_LIMIT,
  BRILSTASH_PILOT_LISTING_LIMIT,
} from '@/config/brilstash-feed';
import { createBrilStashPageProof } from '@/lib/brilstash/page-proof';
import { parseBrilStashBearer } from '@/lib/brilstash/parse-bearer';
import { readBrilStashPage } from '@/lib/brilstash/read-page';
import { resolveBrilStashFeedDeployment } from '@/lib/brilstash/resolve-feed-deployment';
import { logger } from '@/lib/logger';
import { parseBrilStashFeedQuery } from '@/schemas/brilstash-feed-query';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Request-Id': requestId,
  });
  const fail = (status: number, message: string, code: string) =>
    Response.json({ error: message, code }, { status, headers });

  const deployment = resolveBrilStashFeedDeployment();
  if (!deployment)
    return fail(503, 'Catalogue unavailable', 'FEED_UNAVAILABLE');

  const url = new URL(request.url);
  const host = request.headers.get('host') ?? url.host;
  if (host.toLowerCase() !== deployment.host)
    return fail(404, 'Not found', 'NOT_FOUND');

  const bearer = parseBrilStashBearer(request.headers.get('authorization'));
  if (!bearer) return fail(401, 'Invalid partner credential', 'UNAUTHORIZED');

  const query = parseBrilStashFeedQuery(url.searchParams);
  if (
    !query ||
    (deployment.singlePageOnly &&
      (query.page !== 1 ||
        query.limit < BRILSTASH_PILOT_LISTING_LIMIT ||
        query.min_price !== 0))
  ) {
    return fail(400, 'Invalid catalogue query', 'INVALID_QUERY');
  }

  const page = await readBrilStashPage(bearer, query);
  switch (page.status) {
    case 'unauthorized':
      return fail(401, 'Invalid partner credential', 'UNAUTHORIZED');
    case 'invalid_query':
      return fail(400, 'Invalid catalogue query', 'INVALID_QUERY');
    case 'unavailable':
      return fail(503, 'Catalogue unavailable', 'FEED_UNAVAILABLE');
    case 'ok':
      headers.set('X-Total-Count', String(page.totalCount));
      headers.set('X-Total-Pages', String(page.totalPages));
      if (
        query.page === 1 &&
        query.limit === BRILSTASH_HANDOFF_PAGE_LIMIT &&
        query.min_price === 0
      ) {
        headers.set(
          'X-Baci-Catalogue-Proof',
          createBrilStashPageProof(requestId, page)
        );
      }
      logger.info({
        message: 'BrilStash catalogue page served',
        requestId,
        generationId: page.generationId,
        keyId: page.credentialId,
        page: query.page,
        limit: query.limit,
        minPrice: query.min_price,
        totalCount: page.totalCount,
      });
      return Response.json(page.products, { headers });
  }
}

import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import {
  BRILSTASH_FULL_FEED_QUERY,
  BRILSTASH_PARTNER_PRICE_FLOOR,
  BRILSTASH_PILOT_LISTING_LIMIT,
} from '@/config/brilstash-feed';
import { checkBrilStashFeedRateLimit } from '@/lib/brilstash/feed-rate-limit';
import { createBrilStashPageCorrelation } from '@/lib/brilstash/page-correlation';
import { parseBrilStashBearer } from '@/lib/brilstash/parse-bearer';
import { readBrilStashPage } from '@/lib/brilstash/read-page';
import { resolveBrilStashFeedDeployment } from '@/lib/brilstash/resolve-feed-deployment';
import { logger } from '@/lib/logger';
import { createRateLimitResponse } from '@/lib/rate-limit';
import { parseBrilStashFeedQuery } from '@/schemas/brilstash-feed-query';

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Request-Id': requestId,
  });
  const fail = (status: number, message: string, code: string) =>
    Response.json({ error: message, code }, { status, headers });

  const deployment = resolveBrilStashFeedDeployment();
  if (!deployment) {
    if (
      process.env.BRILSTASH_FEED_HOST ||
      process.env.BRILSTASH_FEED_ENV ||
      process.env.BRILSTASH_SUPABASE_PROJECT_REF
    ) {
      logger.warn({
        message: 'BrilStash feed deployment is misconfigured',
        requestId,
      });
    }
    return fail(503, 'Catalogue unavailable', 'FEED_UNAVAILABLE');
  }

  const url = new URL(request.url);
  // Host is client-supplied routing input. Tenant isolation and authentication
  // are enforced by the DB reader's installation bearer and eligibility checks.
  const authority = (request.headers.get('host') ?? url.host).toLowerCase();
  if (authority !== deployment.host && authority !== `${deployment.host}:443`)
    return fail(404, 'Not found', 'NOT_FOUND');

  // Scheme casing is ignored. The RPC receives and authenticates the token
  // exactly as supplied, without the HTTP scheme prefix.
  const bearer = parseBrilStashBearer(request.headers.get('authorization'));

  // The live contract accepts any limit that fits the entire assortment
  // on one page. The separate handoff probe always uses the default limit.
  const query = parseBrilStashFeedQuery(url.searchParams);
  const wholeCataloguePrice =
    query?.min_price === BRILSTASH_FULL_FEED_QUERY.min_price ||
    query?.min_price === BRILSTASH_PARTNER_PRICE_FLOOR;
  const validQuery =
    query !== null &&
    (!deployment.singlePageOnly ||
      (query.page === BRILSTASH_FULL_FEED_QUERY.page &&
        query.limit >= BRILSTASH_PILOT_LISTING_LIMIT &&
        wholeCataloguePrice));

  const budget = await checkBrilStashFeedRateLimit(
    request,
    bearer && validQuery ? 'read' : 'malformed'
  );
  if (!budget.allowed) {
    if (budget.failureReason) {
      logger.warn({
        message: 'BrilStash feed rate limiter unavailable',
        requestId,
        reason: budget.failureReason,
      });
    }
    const response = createRateLimitResponse(
      budget.limit,
      budget.remaining,
      budget.resetTime
    );
    for (const [name, value] of headers) response.headers.set(name, value);
    return response;
  }

  if (!bearer) return fail(401, 'Invalid partner credential', 'UNAUTHORIZED');
  if (!validQuery) return fail(400, 'Invalid catalogue query', 'INVALID_QUERY');

  const page = await readBrilStashPage(bearer, query);
  switch (page.status) {
    case 'unauthorized':
      return fail(401, 'Invalid partner credential', 'UNAUTHORIZED');
    case 'invalid_query':
      return fail(400, 'Invalid catalogue query', 'INVALID_QUERY');
    case 'deadline':
      logger.warn({
        message: 'BrilStash feed read exceeded its deadline',
        requestId,
      });
      return fail(503, 'Catalogue unavailable', 'FEED_UNAVAILABLE');
    case 'ingress_unavailable':
      logger.warn({
        message: 'BrilStash database ingress verification failed',
        requestId,
      });
      return fail(503, 'Catalogue unavailable', 'FEED_UNAVAILABLE');
    case 'misconfigured':
      logger.warn({
        message: 'BrilStash feed ingress signing key is misconfigured',
        requestId,
      });
      return fail(503, 'Catalogue unavailable', 'FEED_UNAVAILABLE');
    case 'unavailable':
      return fail(503, 'Catalogue unavailable', 'FEED_UNAVAILABLE');
    case 'ok':
      if (
        deployment.singlePageOnly &&
        (page.totalPages !== 1 || page.products.length !== page.totalCount)
      ) {
        return fail(503, 'Catalogue unavailable', 'FEED_UNAVAILABLE');
      }
      headers.set('X-Total-Count', String(page.totalCount));
      headers.set('X-Total-Pages', String(page.totalPages));
      if (
        query.page === BRILSTASH_FULL_FEED_QUERY.page &&
        query.limit === BRILSTASH_FULL_FEED_QUERY.limit &&
        wholeCataloguePrice
      ) {
        // The unsigned hash correlates this response with the server log.
        // Auth and payload verification are handled separately.
        headers.set(
          'X-Baci-Catalogue-Correlation',
          createBrilStashPageCorrelation(requestId, page)
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

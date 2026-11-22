import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { logger } from '@/lib/logger';
import { captureServerEvent } from '@/lib/posthog/server';
import { checkTenantRateLimitDetailed } from '@/lib/tenant-rate-limit';
import { authorizePartnerProfile } from '../partner-profile';
import { getPartnerProfiles } from '../partner-profiles';

export const maxDuration = 60;

export async function GET(request: Request) {
  const requestId = randomUUID();
  const reject = (
    status: number,
    error: string,
    headers: Record<string, string> = {}
  ) =>
    Response.json(
      { error, request_id: requestId },
      {
        status,
        headers: { 'Cache-Control': 'private, no-store', ...headers },
      }
    );
  const access = authorizePartnerProfile(
    request.headers.get('authorization'),
    'catalog:read',
    getPartnerProfiles()
  );
  if (!access.ok) {
    if (access.reason === 'scope_required') {
      return reject(403, 'Catalog scope required');
    }
    if (access.reason === 'unconfigured') {
      logger.warn({
        message: 'Partner catalog credential is unconfigured',
        requestId,
      });
    } else if (access.reason === 'ambiguous') {
      logger.warn({
        message: 'Partner catalog credential matches multiple grants',
        requestId,
      });
    }
    return reject(401, 'Unauthorized', { 'WWW-Authenticate': 'Bearer' });
  }

  const { connectionId, profile } = access;
  const { catalogFailure } = profile;
  const unavailableMessage =
    catalogFailure?.message ?? 'Partner catalog unavailable';
  try {
    const limit = await checkTenantRateLimitDetailed(
      'partner-catalog-read',
      connectionId,
      { maxRequests: 120, windowMs: 60_000 }
    );
    if (limit.verdict === 'unavailable') {
      logger.warn({
        message: 'Partner catalog rate limiter unavailable',
        connectionId,
        requestId,
      });
      return reject(503, unavailableMessage);
    }
    if (limit.verdict === 'denied') {
      const now = Date.now();
      const retryAfter = Math.max(
        1,
        Math.ceil(((limit.resetAt ?? now + 60_000) - now) / 1000)
      );
      return reject(429, 'Too many requests', {
        'Retry-After': String(retryAfter),
      });
    }
    const { body, etag } = await profile.readCatalogSnapshot(
      request.headers.get('if-none-match')
    );
    const headers = {
      'Cache-Control': 'private, no-cache',
      ETag: etag,
      Vary: 'Authorization',
    };

    if (body === null) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  } catch {
    logger.warn({
      message: 'Partner catalog snapshot unavailable',
      connectionId,
      requestId,
    });
    after(async () => {
      await captureServerEvent(
        catalogFailure?.event ?? 'partner_catalog_snapshot_unavailable',
        {
          deployment_environment:
            process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
        }
      );
    });
    return reject(503, unavailableMessage);
  }
}

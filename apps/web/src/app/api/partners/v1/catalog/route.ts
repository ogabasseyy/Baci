import { after } from 'next/server';
import { logger } from '@/lib/logger';
import { captureServerEvent } from '@/lib/posthog/server';
import { checkTenantRateLimitDetailed } from '@/lib/tenant-rate-limit';
import { authorizePartnerProfile } from '../partner-profile';
import { getPartnerProfiles } from '../partner-profiles';

export const maxDuration = 60;

const errorHeaders = { 'Cache-Control': 'private, no-store' };

function unavailable(message: string) {
  return Response.json(
    { error: message },
    { status: 503, headers: errorHeaders }
  );
}

function unauthorized() {
  return Response.json(
    { error: 'Unauthorized' },
    {
      status: 401,
      headers: { ...errorHeaders, 'WWW-Authenticate': 'Bearer' },
    }
  );
}

export async function GET(request: Request) {
  const access = authorizePartnerProfile(
    request.headers.get('authorization'),
    'catalog:read',
    getPartnerProfiles()
  );
  if (!access.ok) {
    if (access.reason === 'unconfigured') {
      logger.warn({ message: 'Partner catalog credential is unconfigured' });
    } else if (access.reason === 'ambiguous') {
      logger.warn({
        message: 'Partner catalog credential matches multiple grants',
      });
    }
    return unauthorized();
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
      });
      return unavailable(unavailableMessage);
    }
    if (limit.verdict === 'denied') {
      const now = Date.now();
      const retryAfter = Math.max(
        1,
        Math.ceil(((limit.resetAt ?? now + 60_000) - now) / 1000)
      );
      return Response.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: { ...errorHeaders, 'Retry-After': String(retryAfter) },
        }
      );
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
    after(async () => {
      await captureServerEvent(
        catalogFailure?.event ?? 'partner_catalog_snapshot_unavailable',
        {
          deployment_environment:
            process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
        }
      );
    });
    return unavailable(unavailableMessage);
  }
}

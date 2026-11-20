import { after } from 'next/server';
import { logger } from '@/lib/logger';
import { captureServerEvent } from '@/lib/posthog/server';
import { authorizePartner } from '../partner-connection';
import { getCrossRemConnections } from './catalog-bindings';
import { getVersionedCrossRemCatalog } from './catalog-snapshot';

export const maxDuration = 60;

const errorHeaders = { 'Cache-Control': 'private, no-store' };

function unavailable() {
  return Response.json(
    { error: 'CrossRem catalog unavailable' },
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
  const access = authorizePartner(
    request.headers.get('authorization'),
    getCrossRemConnections(),
    'catalog:read'
  );
  if (!access.ok) {
    if (access.reason === 'unconfigured') {
      logger.warn({ message: 'CrossRem catalog credential is unconfigured' });
    } else if (access.reason === 'ambiguous') {
      logger.warn({
        message: 'CrossRem catalog credential matches multiple grants',
      });
    }
    return unauthorized();
  }

  try {
    const { body, etag } = await getVersionedCrossRemCatalog(
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
      await captureServerEvent('crossrem_catalog_snapshot_unavailable', {
        deployment_environment:
          process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
      });
    });
    return unavailable();
  }
}

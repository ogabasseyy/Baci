import { createHash, timingSafeEqual } from 'node:crypto';
import { after } from 'next/server';
import { captureServerEvent } from '@/lib/posthog/server';
import { loadCrossRemCatalog } from './catalog-service';

// 32 random bytes encoded as unpadded base64url need at least 43 characters.
const bearerTokenPattern = /^[A-Za-z0-9_-]{43,}$/;
const privateHeaders = { 'Cache-Control': 'private, no-store' };

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

function matchesValidator(value: string | null, etag: string) {
  if (value?.trim() === '*') return true;
  return value
    ?.split(',')
    .some((candidate) => candidate.trim().replace(/^W\//, '') === etag);
}

function unavailable() {
  return Response.json(
    { error: 'CrossRem catalog unavailable' },
    { status: 503, headers: privateHeaders }
  );
}

export async function GET(request: Request) {
  const token = process.env.CROSSREM_CATALOG_TOKEN;

  const credential = /^Bearer +(.+)$/i.exec(
    request.headers.get('authorization') ?? ''
  )?.[1];
  if (
    !token ||
    !bearerTokenPattern.test(token) ||
    !credential ||
    !timingSafeEqual(digest(credential), digest(token))
  ) {
    return Response.json(
      { error: 'Unauthorized' },
      {
        status: 401,
        headers: { ...privateHeaders, 'WWW-Authenticate': 'Bearer' },
      }
    );
  }

  try {
    const snapshot = JSON.stringify(await loadCrossRemCatalog());
    const etag = `"${digest(snapshot).toString('hex')}"`;
    const headers = { ...privateHeaders, ETag: etag };

    if (matchesValidator(request.headers.get('if-none-match'), etag)) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(snapshot, {
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

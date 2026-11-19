import { createHash, timingSafeEqual } from 'node:crypto';
import { loadCrossRemCatalog } from './catalog-service';

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
  if (!token?.trim()) return unavailable();

  const credential = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i.exec(
    request.headers.get('authorization') ?? ''
  )?.[1];
  if (!credential || !timingSafeEqual(digest(credential), digest(token))) {
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
    return unavailable();
  }
}

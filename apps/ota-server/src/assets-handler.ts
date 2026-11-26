import type { OtaWorkerEnv } from './types';
import { errorResponse, ValidationError, validateAssetKey } from './validation';

const ASSET_PREFIX = '/api/assets/';
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const SANDBOX_CSP = "default-src 'none'; sandbox";

function parseIfNoneMatchHeader(header: string): string[] {
  const tags: string[] = [];
  let current = '';
  let inQuotes = false;
  let escaped = false;
  for (let i = 0; i < header.length; i += 1) {
    const ch = header[i] ?? '';
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && inQuotes) {
      current += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      const trimmed = current.trim();
      if (trimmed) tags.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const trailing = current.trim();
  if (trailing) tags.push(trailing);
  return tags;
}

function normalizeWeakEtag(tag: string): string {
  const trimmed = tag.trim();
  return trimmed.startsWith('W/') ? trimmed.slice(2).trim() : trimmed;
}

function matchesIfNoneMatch(
  header: string | null,
  httpEtag: string | undefined
): boolean {
  if (!header) return false;
  const candidates = parseIfNoneMatchHeader(header);
  if (candidates.includes('*')) return true;
  if (!httpEtag) return false;
  const target = normalizeWeakEtag(httpEtag);
  return candidates.some((tag) => normalizeWeakEtag(tag) === target);
}

function buildAssetHeaders(
  contentType: string,
  size: number,
  httpEtag: string | undefined,
  sha256Hex: string | undefined,
  includeContentLength: boolean
): Headers {
  const headers = new Headers({
    'content-type': contentType,
    'cache-control': IMMUTABLE_CACHE_CONTROL,
    'x-content-type-options': 'nosniff',
    'content-security-policy': SANDBOX_CSP,
  });
  if (includeContentLength) {
    headers.set('content-length', String(size));
  }
  if (httpEtag) {
    headers.set('etag', httpEtag);
  }
  if (sha256Hex) {
    headers.set('x-asset-sha256', sha256Hex);
  }
  return headers;
}

export async function handleGetAsset(
  request: Request,
  env: OtaWorkerEnv,
  pathname: string
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        allow: 'GET, HEAD',
      },
    });
  }

  let assetKey: string;
  try {
    assetKey = validateAssetKey(pathname.slice(ASSET_PREFIX.length));
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(err.message, err.status);
    }
    throw err;
  }

  const storageKey = `assets/${assetKey}`;
  const ifNoneMatch = request.headers.get('if-none-match');

  if (request.method === 'HEAD') {
    const head = await env.OTA_BUCKET.head(storageKey);
    if (!head) {
      return errorResponse('Asset not found', 404);
    }
    const headers = buildAssetHeaders(
      head.httpMetadata?.contentType ?? 'application/octet-stream',
      head.size,
      head.httpEtag,
      head.customMetadata?.sha256Hex,
      !matchesIfNoneMatch(ifNoneMatch, head.httpEtag)
    );
    if (matchesIfNoneMatch(ifNoneMatch, head.httpEtag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(null, { status: 200, headers });
  }

  const object = await env.OTA_BUCKET.get(storageKey);
  if (!object) {
    return errorResponse('Asset not found', 404);
  }

  const notModified = matchesIfNoneMatch(ifNoneMatch, object.httpEtag);
  const headers = buildAssetHeaders(
    object.httpMetadata?.contentType ?? 'application/octet-stream',
    object.size,
    object.httpEtag,
    object.customMetadata?.sha256Hex,
    !notModified
  );
  if (notModified) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { status: 200, headers });
}

import type { OtaWorkerEnv } from './types';
import { errorResponse, ValidationError, validateAssetKey } from './validation';

const ASSET_PREFIX = '/api/assets/';
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export async function handleGetAsset(
  request: Request,
  env: OtaWorkerEnv,
  pathname: string
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse('Method not allowed', 405);
  }

  const rawKey = pathname.slice(ASSET_PREFIX.length);
  let assetKey: string;
  try {
    assetKey = validateAssetKey(rawKey);
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(err.message, err.status);
    }
    throw err;
  }

  const storageKey = `assets/${assetKey}`;
  if (request.method === 'HEAD') {
    const head = await env.OTA_BUCKET.head(storageKey);
    if (!head) {
      return errorResponse('Asset not found', 404);
    }
    const headers = new Headers({
      'content-type':
        head.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': IMMUTABLE_CACHE_CONTROL,
      'x-content-type-options': 'nosniff',
    });
    if (head.httpEtag) {
      headers.set('etag', head.httpEtag);
    }
    return new Response(null, { status: 200, headers });
  }

  const object = await env.OTA_BUCKET.get(storageKey);
  if (!object) {
    return errorResponse('Asset not found', 404);
  }

  const headers = new Headers({
    'content-type':
      object.httpMetadata?.contentType ?? 'application/octet-stream',
    'cache-control': IMMUTABLE_CACHE_CONTROL,
    'x-content-type-options': 'nosniff',
  });
  if (object.httpEtag) {
    headers.set('etag', object.httpEtag);
  }

  return new Response(object.body, { status: 200, headers });
}

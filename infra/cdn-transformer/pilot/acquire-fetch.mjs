import { assertPublicFetchUrl } from './fetch-policy.mjs';
import { PilotAcquireError } from './inventory-store.mjs';

// Remote-fetch stage for acquisition, extracted from acquire.mjs so each
// module stays under the repository's 300-line ceiling: bounded,
// content-typed http(s) GET with the SSRF guard. Snapshot lifecycle,
// probing, record construction, and inventory publication stay in
// acquire.mjs.
export const EXTENSION_FOR_CONTENT_TYPE = {
  'image/avif': 'avif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function fetchBoundedBytes(
  url,
  { allowPrivateHosts, maxBytes, timeoutMs }
) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new PilotAcquireError(`acquire: invalid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PilotAcquireError(`acquire: only http(s) URLs are allowed`);
  }
  // Loopback fixtures (node:http test servers) opt in explicitly; the
  // operator CLI never does, so a mistyped inventory URL fails closed.
  if (!allowPrivateHosts) {
    assertPublicFetchUrl(url);
  }
  let response;
  try {
    response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new PilotAcquireError(
      `acquire: fetch failed or timed out after ${timeoutMs}ms (${error?.name ?? 'fetch'})`
    );
  }
  if (!response.ok) {
    throw new PilotAcquireError(
      `acquire: origin returned HTTP ${response.status}`
    );
  }
  const contentType = (response.headers.get('content-type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (!Object.hasOwn(EXTENSION_FOR_CONTENT_TYPE, contentType)) {
    await response.body?.cancel?.().catch(() => undefined);
    throw new PilotAcquireError(
      `acquire: unsupported content-type "${contentType}"`
    );
  }
  if (!response.body) {
    throw new PilotAcquireError('acquire: origin returned an empty body');
  }
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new PilotAcquireError(
          `acquire: body exceeds ${maxBytes} byte limit`
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return { bytes: Buffer.concat(chunks), contentType };
}

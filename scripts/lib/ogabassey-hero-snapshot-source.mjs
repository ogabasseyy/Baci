// Bounded, redirect-safe, time-boxed source fetching for the hero snapshot
// pipeline.

import {
  DOWNLOAD_TIMEOUT_MS,
  MAX_SOURCE_BYTES,
  snapshotError,
} from './ogabassey-hero-snapshot-config.mjs';

function finalResponseUrl(res, originalUrl) {
  // `fetch` follows redirects, so the original URL's protocol check is not
  // enough: an HTTPS source may redirect to an `http://` final URL whose
  // bytes would then bake into trusted immutable assets. Real fetch
  // implementations always set `res.url`; nonstandard doubles without it
  // fall back to the already-validated original URL.
  const finalUrl = typeof res.url === 'string' && res.url ? res.url : originalUrl;
  let protocol;
  try {
    protocol = new URL(finalUrl).protocol;
  } catch {
    throw snapshotError(`redirect resolved to an invalid URL: ${finalUrl}`);
  }
  if (protocol !== 'https:') {
    throw snapshotError(
      `refusing non-https final URL after redirects: ${finalUrl}`
    );
  }
  return finalUrl;
}

async function readBoundedBody(res, url) {
  // Enforce the cap WHILE downloading: buffering the whole body first would
  // let a huge response OOM the generator before the controlled error.
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) {
    throw snapshotError(
      `fetch ${url} -> declared ${declared} bytes (limit ${MAX_SOURCE_BYTES})`
    );
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_SOURCE_BYTES) {
      throw snapshotError(
        `fetch ${url} -> ${bytes.length} bytes (limit ${MAX_SOURCE_BYTES})`
      );
    }
    return bytes;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SOURCE_BYTES) {
      // eslint-disable-next-line no-await-in-loop
      await reader.cancel();
      throw snapshotError(
        `fetch ${url} -> over ${MAX_SOURCE_BYTES} bytes (limit ${MAX_SOURCE_BYTES})`
      );
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length === 0) {
    throw snapshotError(`fetch ${url} -> 0 bytes (limit ${MAX_SOURCE_BYTES})`);
  }
  return bytes;
}

function isTimeoutCause(error) {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

export async function fetchSnapshotSource(url, fetchImpl) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw snapshotError(`not a URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw snapshotError(`refusing non-https source: ${url}`);
  }
  // Time-box the whole download (connect, headers, and body): a stalled
  // server must surface as a controlled error, never hang the pipeline.
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(url, { redirect: 'follow', signal });
  } catch (error) {
    if (isTimeoutCause(error)) {
      throw snapshotError(
        `fetch ${url} -> timed out after ${DOWNLOAD_TIMEOUT_MS}ms`
      );
    }
    throw error;
  }
  if (!res.ok) {
    throw snapshotError(`fetch ${url} -> HTTP ${res.status}`);
  }
  finalResponseUrl(res, url);
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    throw snapshotError(`fetch ${url} -> unexpected content-type ${contentType}`);
  }
  try {
    return await readBoundedBody(res, url);
  } catch (error) {
    if (isTimeoutCause(error)) {
      throw snapshotError(
        `fetch ${url} -> timed out after ${DOWNLOAD_TIMEOUT_MS}ms`
      );
    }
    throw error;
  }
}

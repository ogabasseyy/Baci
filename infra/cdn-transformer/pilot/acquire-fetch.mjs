import http from 'node:http';
import https from 'node:https';
import {
  assertPublicFetchUrl,
  resolvePublicFetchAddresses,
} from './fetch-policy.mjs';
import { PilotAcquireError } from './inventory-store.mjs';

// Connect-time DNS lookup with SSRF pinning, shared by the fetch path
// and its contract tests: resolves AND validates at connect time and
// pins the socket to a validated address; SNI and the Host header
// still use the URL hostname. Honors the lookup callback contract on
// both forms — Node 20+ invokes lookup with `all: true` (expecting an
// address array back) while older callers use the single-address form.
export function createPinnedLookup(dnsResolve) {
  return (hostname, options, callback) => {
    resolvePublicFetchAddresses(hostname, dnsResolve).then(
      (addresses) => {
        if (options?.all) {
          callback(
            null,
            addresses.map(({ address, family }) => ({ address, family }))
          );
        } else {
          callback(null, addresses[0].address, addresses[0].family);
        }
      },
      (error) => {
        callback(
          error instanceof Error ? error : new Error(String(error)),
          null
        );
      }
    );
  };
}

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
  { allowPrivateHosts, dnsResolve, maxBytes, timeoutMs }
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
  // No userinfo: the acquisition path is documented public and
  // credential-free, and the inventory persists the URL verbatim — a
  // password here would ride into retained evidence and review packets.
  if (parsed.username || parsed.password) {
    throw new PilotAcquireError(
      `acquire: URLs with credentials are not allowed`
    );
  }
  // Loopback fixtures (node:http test servers) opt in explicitly; the
  // operator CLI never does, so a mistyped inventory URL fails closed.
  if (!allowPrivateHosts) {
    assertPublicFetchUrl(url);
  }
  // node:http(s) instead of global fetch: fetch offers no DNS hook, and
  // resolving up front would reopen the rebinding window between
  // validation and connect. The lookup override below resolves AND
  // validates at connect time and pins the socket to a validated
  // address; SNI and the Host header still use the URL hostname.
  // Redirects are never followed (the old redirect:'error' behavior).
  const transport = parsed.protocol === 'https:' ? https : http;
  const lookup = allowPrivateHosts ? undefined : createPinnedLookup(dnsResolve);
  let response;
  try {
    response = await new Promise((resolvePromise, reject) => {
      const request = transport.get(
        parsed,
        { lookup, signal: AbortSignal.timeout(timeoutMs) },
        resolvePromise
      );
      request.on('error', reject);
    });
  } catch (error) {
    // Precise policy rejections (resolution failures) keep their own
    // message; transport failures map to the fetch-failed contract.
    if (error instanceof PilotAcquireError) {
      throw error;
    }
    throw new PilotAcquireError(
      `acquire: fetch failed or timed out after ${timeoutMs}ms (${error?.name ?? 'fetch'})`
    );
  }
  if (response.statusCode < 200 || response.statusCode > 299) {
    response.destroy();
    throw new PilotAcquireError(
      `acquire: origin returned HTTP ${response.statusCode}`
    );
  }
  const contentType = String(response.headers['content-type'] ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (!Object.hasOwn(EXTENSION_FOR_CONTENT_TYPE, contentType)) {
    response.destroy();
    throw new PilotAcquireError(
      `acquire: unsupported content-type "${contentType}"`
    );
  }
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of response) {
      total += chunk.length;
      if (total > maxBytes) {
        response.destroy();
        throw new PilotAcquireError(
          `acquire: body exceeds ${maxBytes} byte limit`
        );
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof PilotAcquireError) {
      throw error;
    }
    throw new PilotAcquireError(
      `acquire: fetch failed or timed out after ${timeoutMs}ms (${error?.name ?? 'fetch'})`
    );
  }
  // An empty body is never a valid image: fail here with the curated
  // message instead of probing zero bytes downstream.
  if (total === 0) {
    throw new PilotAcquireError('acquire: origin returned an empty body');
  }
  return { bytes: Buffer.concat(chunks), contentType };
}

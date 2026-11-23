import 'server-only';
import { request } from 'node:https';
import { createSecureContext } from 'node:tls';
import { PUBLIC_VERIFICATION_CLIENT_TIMEOUT_MS } from './public-verification-deadline';

const paths = new Map([
  [
    'https://owner.baci-internal.invalid/internal/owner/preview',
    'x-baci-owner-signature',
  ],
  [
    'https://owner.baci-internal.invalid/internal/owner/attest',
    'x-baci-verifier-signature',
  ],
  [
    'https://owner.baci-internal.invalid/internal/owner/public',
    'x-baci-verifier-signature',
  ],
]);

/** Fixed, mutually authenticated owner transport; all settings are server-side only. */
export function createOwnerMtlsFetch(settings: {
  origin: string;
  cert: string;
  key: string;
  ca?: string;
}): typeof fetch {
  const origin = new URL(settings.origin);
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    origin.origin !== settings.origin ||
    !settings.cert ||
    !settings.key
  )
    throw Error('INVALID_OWNER_MTLS_CONFIG');
  // Parse TLS material at startup so malformed credentials fail before use.
  createSecureContext({
    cert: settings.cert,
    key: settings.key,
    ...(settings.ca ? { ca: settings.ca } : {}),
  });
  return async (input, init) => {
    const target =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : '';
    const signatureHeader = paths.get(target);
    if (
      !signatureHeader ||
      init?.method !== 'POST' ||
      typeof init.body !== 'string' ||
      Buffer.byteLength(init.body) > 16384
    )
      throw Error('INVALID_OWNER_MTLS_REQUEST');
    const headers = new Headers(init.headers);
    const signature = headers.get(signatureHeader);
    if (
      !signature ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      headers.get('content-type') !== 'application/json'
    )
      throw Error('INVALID_OWNER_MTLS_REQUEST');
    const path = new URL(target).pathname;
    return await new Promise<Response>((resolve, reject) => {
      const req = request(
        {
          protocol: 'https:',
          hostname: origin.hostname,
          port: origin.port || 443,
          path,
          method: 'POST',
          cert: settings.cert,
          key: settings.key,
          ...(settings.ca ? { ca: settings.ca } : {}),
          signal: init.signal ?? undefined,
          headers: {
            'content-type': 'application/json',
            [signatureHeader]: signature,
            'content-length': Buffer.byteLength(init.body as string),
          },
        },
        (res) => {
          const status = res.statusCode ?? 502;
          if (status >= 300 && status < 400) {
            res.resume();
            reject(Error('OWNER_MTLS_REDIRECT'));
            return;
          }
          if (
            ![
              200, 204, 400, 401, 403, 404, 409, 413, 429, 500, 502, 503, 504,
            ].includes(status)
          ) {
            res.resume();
            reject(Error('OWNER_MTLS_INVALID_STATUS'));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 262144) {
              reject(Error('OWNER_MTLS_RESPONSE_TOO_LARGE'));
              res.destroy(Error('OWNER_MTLS_RESPONSE_TOO_LARGE'));
              return;
            }
            chunks.push(chunk);
          });
          res.once('error', reject);
          res.once('aborted', () =>
            reject(Error('OWNER_MTLS_RESPONSE_ABORTED'))
          );
          res.once('end', () =>
            resolve(
              new Response(status === 204 ? null : Buffer.concat(chunks), {
                status,
                headers: {
                  'content-type': 'application/json',
                  'cache-control': 'no-store',
                },
              })
            )
          );
        }
      );
      req.once('error', reject);
      req.setTimeout(
        path === '/internal/owner/public'
          ? PUBLIC_VERIFICATION_CLIENT_TIMEOUT_MS
          : 600000,
        () => req.destroy(Error('OWNER_MTLS_TIMEOUT'))
      );
      req.end(init.body as string);
    });
  };
}

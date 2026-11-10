import { authorizePreviewResource } from '../../src/lib/experience/preview-resource';
import type { PreviewVault } from '../../src/lib/experience/preview-service';
import { productionDeliveryOrigins } from '../../src/lib/experience/production-origins';

/** Output-only HTTPS ingress. The shared vault rechecks normal anon RLS liveness
 * on every resource; this handler cannot create launches or execute source. */
export function createProductionPreviewDelivery(config: {
  vault: PreviewVault;
  executionOrigin: string;
  hostOrigins: readonly string[];
}) {
  const { executionOrigin, hostOrigins } = productionDeliveryOrigins(config);
  if (config.vault.origin !== executionOrigin)
    throw Error('INVALID_VAULT_ORIGIN');
  const headers = {
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    Vary: 'Origin',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; script-src ${executionOrigin}; style-src ${executionOrigin} 'unsafe-inline'; img-src ${executionOrigin}; font-src ${executionOrigin}; connect-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${hostOrigins.join(' ')}`,
    'Permissions-Policy':
      'camera=(), microphone=(), geolocation=(), payment=()',
  };
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    if (origin && origin !== 'null' && !hostOrigins.includes(origin))
      return new Response(null, { status: 404, headers });
    if (
      url.origin !== executionOrigin ||
      request.method !== 'GET' ||
      url.search ||
      url.hash
    )
      return new Response(null, { status: 404, headers });
    const match = url.pathname.match(
      /^\/resource\/([a-f0-9]{64})\/(index\.html|app\.(?:js|css)|assets\/[a-z0-9-]{1,80})$/
    );
    if (!match) return new Response(null, { status: 404, headers });
    try {
      const file = await authorizePreviewResource(
        config.vault,
        match[1],
        match[2]
      );
      return new Response(Uint8Array.from(file.bytes), {
        headers: {
          ...headers,
          'Content-Type': file.mime,
          // Sandboxed module/font requests carry the opaque Origin: null.
          // Documents never grant CORS read access; ordinary foreign origins are rejected.
          ...(file.mime !== 'text/html' && origin
            ? { 'Access-Control-Allow-Origin': origin }
            : {}),
        },
      });
    } catch {
      return new Response('Preview expired or unavailable.', {
        status: 404,
        headers,
      });
    }
  };
}

import { createServer } from 'node:http';
import { authorizePreviewResource } from '../../src/lib/experience/preview-resource';
import type { PreviewVault } from '../../src/lib/experience/preview-service';
import { productionDeliveryOrigins } from '../../src/lib/experience/production-origins';
/** Local execution origin only. This server cannot create launches or access tenant tables. */
export async function startPreviewGateway(
  vault: PreviewVault,
  port: number,
  hostOrigin: string,
  externalOrigin?: string
) {
  if (externalOrigin)
    productionDeliveryOrigins({
      executionOrigin: externalOrigin,
      hostOrigins: [hostOrigin],
    });
  let boundPort = port;
  const server = createServer(async (req, res) => {
    const resourceOrigin = externalOrigin ?? `http://127.0.0.1:${boundPort}`;
    const headers = {
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'; script-src ${resourceOrigin}; style-src ${resourceOrigin} 'unsafe-inline'; img-src ${resourceOrigin}; font-src ${resourceOrigin}; connect-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${hostOrigin}`,
      'Permissions-Policy':
        'camera=(), microphone=(), geolocation=(), payment=()',
    };
    if (req.method !== 'GET') {
      res.writeHead(405, headers);
      res.end();
      return;
    }
    const match = req.url?.match(/^\/resource\/([a-f0-9]{64})\/(.+)$/);
    if (!match) {
      res.writeHead(404, headers);
      res.end();
      return;
    }
    try {
      const f = await authorizePreviewResource(vault, match[1], match[2]);
      res.writeHead(200, { ...headers, 'Content-Type': f.mime });
      res.end(f.bytes);
    } catch {
      res.writeHead(404, headers);
      res.end('Preview expired or unavailable.');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address !== 'string') boundPort = address.port;
      resolve();
    });
  });
  return {
    origin: `http://127.0.0.1:${boundPort}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}

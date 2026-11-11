import 'server-only';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { productionOrigin } from './production-origins';

const responseHeaders = new Set([
  'access-control-allow-origin',
  'cache-control',
  'content-security-policy',
  'content-type',
  'cross-origin-resource-policy',
  'permissions-policy',
  'referrer-policy',
  'vary',
  'x-baci-output-digest',
  'x-content-type-options',
  'x-robots-tag',
]);

/** Output-only listener; TLS and the fixed execution Host belong to the ingress. */
export function createProductionDeliveryListener(settings: {
  executionOrigin: string;
  deliver(request: Request): Promise<Response>;
}) {
  const origin = productionOrigin(settings.executionOrigin);
  const host = new URL(origin).host;
  const server = createServer(async (req, res) => {
    const unavailable = () => {
      if (!res.headersSent) {
        res.writeHead(404, { 'Cache-Control': 'no-store' });
        res.end('Unavailable');
      } else res.destroy();
    };
    try {
      const path = req.url;
      if (
        req.method !== 'GET' ||
        req.headers.host !== host ||
        req.rawHeaders.filter(
          (_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'host'
        ).length !== 1 ||
        !path ||
        path.length > 4096 ||
        path.startsWith('//') ||
        /[\\#]/.test(path) ||
        Array.from(path).some((char) => char.charCodeAt(0) <= 32) ||
        !(path.startsWith('/resource/') || path.startsWith('/published/'))
      ) {
        unavailable();
        return;
      }
      const headers = new Headers();
      if (req.headers.origin) headers.set('origin', req.headers.origin);
      const request = new Request(`${origin}${path}`, {
        method: 'GET',
        headers,
      });
      const response = await settings.deliver(request);
      const output: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        if (responseHeaders.has(name)) output[name] = value;
      });
      res.writeHead(response.status, output);
      if (!response.body) res.end();
      else await pipeline(Readable.fromWeb(response.body as never), res);
    } catch {
      unavailable();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return {
    server,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (
            error &&
            (!('code' in error) || error.code !== 'ERR_SERVER_NOT_RUNNING')
          )
            reject(error);
          else resolve();
        })
      );
    },
  };
}

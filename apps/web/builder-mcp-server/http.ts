import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  hostHeaderValidation,
  NodeStreamableHTTPServerTransport,
} from '@modelcontextprotocol/node';
import { builderAuthChallenge } from '../src/lib/builder-connector/tool-policy';
import {
  createRateLimiter,
  resolveClientIp,
} from '../tools/connector-gateway/rate-limit';
import {
  BUILDER_METADATA_PATH,
  BUILDER_RESOURCE,
  builderProtectedResource,
} from './metadata';
import type { BuilderMcpDependencies } from './registry';
import { createBuilderMcpServer } from './server';

const allowedOrigins = new Set([
  'https://chatgpt.com',
  'https://usebaci.com',
  'https://mcp.usebaci.com',
]);
export function createBuilderMcpHttpHandler(
  deps: Pick<BuilderMcpDependencies, 'executeBuilderTool'> & {
    verifyAccessToken: (token: string) => Promise<void>;
    trustedProxies?: readonly string[];
  }
) {
  let closing = false;
  const active = new Set<() => Promise<void>>();
  const rate = createRateLimiter({
    windowMs: 60000,
    maxPerKey: 120,
    maxPerIp: 120,
  });
  const validHost = hostHeaderValidation([
    'mcp.usebaci.com',
    '127.0.0.1',
    'localhost',
    '[::1]',
  ]);
  const reply = (res: ServerResponse, status: number, error: string) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify({ error }));
  };
  const challenge = (res: ServerResponse) => {
    res.setHeader(
      'www-authenticate',
      builderAuthChallenge('CONNECTION_REVOKED', 'list_storefronts')._meta[
        'mcp/www_authenticate'
      ][0]
    );
    reply(res, 401, 'Reconnect Baci to continue.');
  };
  return {
    async close() {
      closing = true;
      await Promise.allSettled([...active].map((close) => close()));
    },
    async handle(req: IncomingMessage, res: ServerResponse) {
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('cache-control', 'no-store');
      if (closing) {
        reply(res, 503, 'Builder transport is stopping.');
        return;
      }
      if (!validHost(req, res)) return;
      const url = new URL(req.url ?? '/', BUILDER_RESOURCE);
      if (url.origin !== new URL(BUILDER_RESOURCE).origin || url.search) {
        reply(res, 404, 'Not found');
        return;
      }
      if (
        !rate.check({
          keyId: null,
          ip: resolveClientIp({
            socketAddress: req.socket.remoteAddress ?? 'unknown',
            forwardedFor: req.headers['x-forwarded-for'],
            trustedProxies: deps.trustedProxies ?? [],
          }),
        }).allowed
      ) {
        reply(res, 429, 'Too many requests');
        return;
      }
      if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) {
        reply(res, 403, 'Origin not allowed');
        return;
      }
      if (url.pathname === BUILDER_METADATA_PATH && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(builderProtectedResource));
        return;
      }
      if (url.pathname !== '/builder/mcp') {
        reply(res, 404, 'Not found');
        return;
      }
      if (req.headers['mcp-session-id']) {
        reply(res, 400, 'This transport is stateless.');
        return;
      }
      const header = req.headers.authorization;
      let token: string | undefined;
      if (header) {
        if (header.length > 8192 || !/^Bearer [A-Za-z0-9_.-]+$/i.test(header)) {
          challenge(res);
          return;
        }
        token = header.slice(7);
        try {
          await deps.verifyAccessToken(token);
        } catch {
          challenge(res);
          return;
        }
      }
      if (req.method !== 'POST') {
        if (!token) {
          challenge(res);
          return;
        }
        res.setHeader('allow', 'POST');
        reply(res, 405, 'Method not allowed');
        return;
      }
      if (
        !req.headers['content-type']
          ?.toLowerCase()
          .startsWith('application/json')
      ) {
        reply(res, 415, 'JSON required');
        return;
      }
      let body: unknown;
      let size = 0;
      const chunks: Buffer[] = [];
      try {
        for await (const chunk of req) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > 65536) {
            reply(res, 413, 'Request too large');
            return;
          }
          chunks.push(bytes);
        }
        body = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            Buffer.concat(chunks)
          )
        );
      } catch {
        reply(res, 400, 'Invalid JSON');
        return;
      }
      const controller = new AbortController();
      const server = createBuilderMcpServer({
        ...deps,
        bearerToken: token,
        signal: controller.signal,
      });
      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      let cleaned = false;
      const cleanup = async () => {
        if (cleaned) return;
        cleaned = true;
        controller.abort();
        active.delete(cleanup);
        await Promise.allSettled([transport.close(), server.close()]);
        if (!res.writableEnded) {
          if (!res.headersSent)
            reply(
              res,
              503,
              'Request interrupted. Read status before retrying.'
            );
          else res.end();
        }
      };
      active.add(cleanup);
      res.once('close', () => {
        void cleanup();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch {
        if (!res.headersSent)
          reply(res, 500, 'Operation could not be completed. Read its status.');
      } finally {
        if (res.writableEnded) await cleanup();
      }
    },
  };
}

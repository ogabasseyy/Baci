#!/usr/bin/env node
/** Read-only gateway: validated grants, transaction-local user claims, and RLS. */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import {
  type ConnectorErrorCode,
  connectorError,
} from '../../src/lib/connector/errors';
import { CONNECTOR_MANIFEST } from '../../src/lib/connector/manifest';
import {
  createHarnessSql as createGatewaySql,
  type HarnessSql as GatewaySql,
} from '../connector-harness/gateway';
import {
  bearerToken,
  sendJson,
  sendUnexpectedError,
  sha256Hex,
} from '../connector-http';
import { createGatewayAudit } from './audit';
import { runGatewayCli } from './cli';
import type { GatewayConfig } from './config';
import { GATEWAY_DOCS_HTML } from './docs-page';
import { handleIssueToken } from './issue-token';
import { buildGatewayOpenApiDocument } from './openapi';
import { createRateLimiter, resolveClientIp } from './rate-limit';
import { handleRefresh } from './refresh';
import { createRejectionSampler } from './rejection-sampler';
import { handleRevoke } from './revoke';
import { handleToolRequest } from './tool-request';

function sendHtml(response: ServerResponse, body: string): void {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    'cache-control': 'public, max-age=300',
  });
  response.end(body);
}

function sendError(
  response: ServerResponse,
  status: number,
  error: string,
  code: ConnectorErrorCode,
  headers: Record<string, string> = {}
): void {
  sendJson(response, status, connectorError(code, error), headers);
}

export interface StartedGateway {
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * Start the gateway server. Exported so the runtime regression suite can
 * drive the real HTTP surface.
 */
export function startGatewayServer(
  config: GatewayConfig
): Promise<StartedGateway> {
  const sql: GatewaySql = createGatewaySql(config.databaseUrl);

  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validators = new Map(
    CONNECTOR_MANIFEST.map((tool) => [tool.name, ajv.compile(tool.inputSchema)])
  );

  const limiter = createRateLimiter({
    windowMs: config.rateLimitWindowMs,
    maxPerKey: config.rateLimitPerKey,
    maxPerIp: config.rateLimitPerIp,
  });

  // Bounded rejection auditing: at most one 429 row per client per
  // window, so a flood of denied requests cannot turn into a flood of
  // audit INSERTs. Sampling stops for new identities when the cache is full.
  const shouldAuditRejection = createRejectionSampler(config.rateLimitWindowMs);

  // Durable audit: grant id, route, status, latency only. Failures are
  // reported on stderr without request detail and never break the call,
  // so a sick audit sink cannot take reads down with it.
  const audit = createGatewayAudit(sql);

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      void error;
      sendUnexpectedError(response);
    });
  });

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const started = Date.now();
    const url = new URL(
      request.url ?? '/',
      `http://${config.host}:${config.port}`
    );
    const ip = resolveClientIp({
      socketAddress: request.socket.remoteAddress ?? 'unknown',
      forwardedFor: request.headers['x-forwarded-for'],
      trustedProxies: config.trustedProxies,
    });
    const presented = bearerToken(request);
    const isToolRoute =
      request.method === 'POST' && url.pathname.startsWith('/v0/tools/');

    // Tool routes consume the per-key budget (keyed by credential hash)
    // plus the shared IP budget; every other route consumes IP only.
    const keyId = isToolRoute && presented ? sha256Hex(presented) : null;
    const limit = limiter.check({ keyId, ip });
    if (!limit.allowed) {
      const retryAfter = Math.max(
        1,
        Math.ceil(limit.retryAfterMs / 1000)
      ).toString();
      // Sample by the budget that actually denied: IP denials by IP
      // alone, so attacker-chosen credentials cannot mint distinct
      // sampling entries and defeat the bound.
      const samplingId =
        limit.limitedBy === 'key' && keyId !== null ? `${ip}|${keyId}` : ip;
      if (shouldAuditRejection(samplingId)) {
        await audit({
          grantId: null,
          route: url.pathname,
          status: 429,
          started,
        });
      }
      sendError(response, 429, 'Rate limit exceeded.', 'RATE_LIMITED', {
        'retry-after': retryAfter,
      });
      return;
    }

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        let db: 'up' | 'down' = 'down';
        try {
          await sql`SELECT 1`;
          db = 'up';
        } catch {
          db = 'down';
        }
        // Health checks are infrastructure noise, not merchant access. Keep
        // them out of the durable connector audit table.
        sendJson(response, 200, {
          status: 'ok',
          gateway: 'r1-readonly',
          db,
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/openapi.json') {
        sendJson(
          response,
          200,
          buildGatewayOpenApiDocument(config.publicBaseUrl)
        );
        return;
      }

      if (request.method === 'GET' && url.pathname === '/docs') {
        sendHtml(response, GATEWAY_DOCS_HTML);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v0/issue-token') {
        await handleIssueToken({
          request,
          response,
          config,
          sql,
          presented,
          url,
          started,
          audit,
          sendError,
          validators,
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v0/refresh') {
        await handleRefresh({
          request,
          response,
          config,
          sql,
          presented,
          url,
          started,
          audit,
          sendError,
          validators,
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v0/revoke') {
        await handleRevoke({
          request,
          response,
          config,
          sql,
          presented,
          url,
          started,
          audit,
          sendError,
          validators,
        });
        return;
      }

      const toolMatch = url.pathname.match(/^\/v0\/tools\/([^/]+)$/);
      if (request.method === 'POST' && toolMatch?.[1]) {
        await handleToolRequest(
          {
            request,
            response,
            config,
            sql,
            presented,
            url,
            started,
            audit,
            sendError,
            validators,
          },
          toolMatch[1]
        );
        return;
      }

      await audit({ grantId: null, route: url.pathname, status: 404, started });
      sendError(response, 404, 'Not found.', 'INVALID_REQUEST');
    } catch {
      // readJsonBody iteration failures and similar land here safely.
      if (!response.headersSent) {
        sendError(response, 400, 'Invalid request.', 'INVALID_REQUEST');
      }
    }
  }

  return new Promise<StartedGateway>((resolve, reject) => {
    server.on('error', (error: unknown) => {
      void sql.end({ timeout: 5 }).finally(() => reject(error));
    });
    server.listen(config.port, config.host, () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address !== null
          ? address.port
          : config.port;
      resolve({
        baseUrl: `http://${config.host}:${port}`,
        close: async () => {
          await new Promise<void>((done) => {
            server.close(() => done());
          });
          await sql.end({ timeout: 5 });
        },
      });
    });
  });
}

const invokedDirectly = (process.argv[1] ?? '').match(/server\.(ts|js)$/);
if (invokedDirectly) {
  runGatewayCli(startGatewayServer);
}

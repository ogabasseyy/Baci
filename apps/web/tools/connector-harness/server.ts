#!/usr/bin/env node
/**
 * R0 connector harness server (test-only, never production).
 *
 * Minimal isolated runtime for the R0 pilot proofs: discovery, manual
 * test-token issuance, bounded order reads, and safe denials. Start with:
 *
 *   cd apps/web && HARNESS_ENABLED=1 HARNESS_DATABASE_URL=... \
 *     HARNESS_OWNER_SECRET=... HARNESS_TEST_OWNER_USER_ID=... \
 *     HARNESS_TEST_MERCHANT_ID=... ../../node_modules/.bin/tsx \
 *     tools/connector-harness/server.ts
 *
 * See tools/connector-harness/README.md for endpoints and Muse access.
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { ConnectorErrorCode } from '../../src/lib/connector/errors';
import { CONNECTOR_MANIFEST } from '../../src/lib/connector/manifest';
import { sendJson } from '../connector-http';
import { type HarnessConfig, loadHarnessConfig } from './config';
import { createHarnessSql } from './gateway';
import { handleManagementRequest } from './management-request';
import { buildOpenApiDocument } from './openapi';
import { handleToolRequest } from './tool-request';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;

function sendError(
  response: ServerResponse,
  status: number,
  error: string,
  code?: ConnectorErrorCode
): void {
  sendJson(response, status, code ? { error, code } : { error });
}

export interface StartedHarness {
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * Start the harness server. Exported so the runtime regression suite can
 * drive the real HTTP surface; the CLI entry below stays the only
 * production-adjacent launcher (and refuses production itself).
 */
export function startHarnessServer(
  config: HarnessConfig
): Promise<StartedHarness> {
  const sql = createHarnessSql(config.databaseUrl);

  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validators = new Map(
    CONNECTOR_MANIFEST.map((tool) => [tool.name, ajv.compile(tool.inputSchema)])
  );

  const hitsByIp = new Map<string, { count: number; resetAt: number }>();
  function rateLimited(ip: string): boolean {
    const now = Date.now();
    const entry = hitsByIp.get(ip);
    if (!entry || entry.resetAt <= now) {
      hitsByIp.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return false;
    }
    entry.count += 1;
    return entry.count > RATE_LIMIT_MAX;
  }

  function audit(entry: Record<string, unknown>): void {
    process.stdout.write(
      `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`
    );
  }

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      audit({ route: 'unhandled', error: 'internal' });
      void error;
      sendError(response, 500, 'Connector request failed.', 'UNKNOWN_OUTCOME');
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
    const ip = request.socket.remoteAddress ?? 'unknown';

    if (rateLimited(ip)) {
      audit({ route: url.pathname, status: 429 });
      sendError(response, 429, 'Rate limit exceeded.');
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
        sendJson(response, 200, {
          status: 'ok',
          harness: 'r0',
          db,
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/openapi.json') {
        const base =
          process.env.HARNESS_PUBLIC_BASE_URL?.trim() ||
          `http://${config.host}:${config.port}`;
        sendJson(response, 200, buildOpenApiDocument(base));
        return;
      }

      if (
        await handleManagementRequest({
          request,
          response,
          config,
          sql,
          url,
          started,
          audit,
          sendError,
          validators,
        })
      )
        return;

      const toolMatch = url.pathname.match(/^\/v0\/tools\/([^/]+)$/);
      if (request.method === 'POST' && toolMatch?.[1]) {
        await handleToolRequest(
          {
            request,
            response,
            config,
            sql,
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

      sendError(response, 404, 'Not found.');
    } catch {
      // readJsonBody iteration failures and similar land here safely.
      if (!response.headersSent) {
        sendError(response, 400, 'Invalid request.');
      }
    }
  }

  return new Promise<StartedHarness>((resolve, reject) => {
    server.on('error', (error: unknown) => {
      void sql.end({ timeout: 5 }).finally(() => reject(error));
    });
    server.listen(config.port, config.host, () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address !== null
          ? address.port
          : config.port;
      audit({
        event: 'harness_listening',
        host: config.host,
        port,
      });
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

function runCli(): void {
  let config: HarnessConfig;
  try {
    config = loadHarnessConfig(process.env);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'startup_failed';
    process.stderr.write(`harness startup failed: ${message}\n`);
    process.exit(1);
  }
  let harness: StartedHarness | null = null;
  startHarnessServer(config).then(
    (started) => {
      harness = started;
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : 'startup_failed';
      process.stderr.write(`harness startup failed: ${message}\n`);
      process.exit(1);
    }
  );
  const shutdown = () => {
    const active = harness;
    if (active) {
      void active.close().finally(() => process.exit(0));
    } else {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const invokedDirectly = (process.argv[1] ?? '').match(/server\.(ts|js)$/);
if (invokedDirectly) {
  runCli();
}

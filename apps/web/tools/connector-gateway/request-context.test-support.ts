import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { vi } from 'vitest';
import type { HarnessSql } from '../connector-harness/gateway';
import type { GatewayRequestContext } from './request-context';
export function makeRequestContext(path: string): GatewayRequestContext {
  const request = new IncomingMessage(new Socket());
  request.method = 'POST';
  request.url = path;
  return {
    request,
    response: new ServerResponse(request),
    config: {
      host: '127.0.0.1',
      port: 0,
      databaseUrl: 'postgres://unused',
      localGrantManagement: null,
      publicBaseUrl: 'https://example.test',
      rateLimitPerKey: 10,
      rateLimitPerIp: 20,
      rateLimitWindowMs: 60000,
      trustedProxies: [],
    },
    sql: vi.fn() as unknown as HarnessSql,
    presented: null,
    url: new URL(path, 'https://example.test'),
    started: Date.now(),
    validators: new Map(),
    audit: vi.fn().mockResolvedValue(undefined),
    sendError: vi.fn(),
  };
}

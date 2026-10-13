import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { vi } from 'vitest';
import type { HarnessSql } from './gateway';
import type { HarnessRequestContext } from './request-context';
export function makeRequestContext(path: string): HarnessRequestContext {
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
      ownerSecret: 'test-owner-secret',
      testOwnerUserId: 'owner',
      testMerchantId: 'merchant',
    },
    sql: vi.fn() as unknown as HarnessSql,
    url: new URL(path, 'https://example.test'),
    started: Date.now(),
    validators: new Map(),
    audit: vi.fn(),
    sendError: vi.fn(),
  };
}

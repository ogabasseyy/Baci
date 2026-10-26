import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { test } from 'node:test';
import { createInteractionHandler } from './interactions.ts';

function fixture(pending: unknown) {
  let begins = 0;
  let status = 0;
  let location = '';
  const stored: unknown[] = [];
  const deps = {
    provider: {
      interactionDetails: async () => ({
        uid: 'new-flow',
        params: {
          resource: 'https://usebaci.com/builder/mcp',
          scope: 'storefront.read',
        },
      }),
    },
    storage: {
      takeTransaction: async () => pending,
      putTransaction: async (_id: string, _browser: string, value: unknown) => {
        stored.push(value);
      },
    },
    upstream: {
      begin: async () => {
        begins++;
        return {
          url: new URL('https://accounts.example.test/authorize'),
          transaction: { state: 'fresh' },
        };
      },
    },
    issuer: 'https://auth.usebaci.com',
    resource: 'https://usebaci.com/builder/mcp',
    supabase: { url: 'https://fixture.supabase.co', anonKey: 'public-fixture' },
    connectionTtlSeconds: 600,
  } as unknown as Parameters<typeof createInteractionHandler>[0];
  const response = {
    setHeader: () => {},
    writeHead: (value: number, headers?: Record<string, string>) => {
      status = value;
      location = headers?.location ?? '';
    },
    end: () => {},
  } as unknown as ServerResponse;
  const request = (method: string) =>
    ({
      method,
      url: '/interaction/new-flow',
      headers: { cookie: '__Host-baci-builder-link=fixture-secret' },
    }) as IncomingMessage;
  return {
    run: (method: string) =>
      createInteractionHandler(deps)(request(method), response),
    state: () => ({ begins, status, location, stored }),
  };
}
test('restarts GET for expired cookies, another flow and abandoned upstream transactions', async () => {
  for (const pending of [
    null,
    { uid: 'old-flow', stage: 'consent', transaction: {} },
    { uid: 'new-flow', stage: 'upstream', transaction: {} },
  ]) {
    const f = fixture(pending);
    assert.equal(await f.run('GET'), true);
    assert.deepEqual(f.state(), {
      begins: 1,
      status: 303,
      location: 'https://accounts.example.test/authorize',
      stored: [
        { uid: 'new-flow', stage: 'upstream', transaction: { state: 'fresh' } },
      ],
    });
  }
});
test('does not restart or accept a POST from a different interaction', async () => {
  const f = fixture({ uid: 'old-flow', stage: 'consent', transaction: {} });
  await assert.rejects(f.run('POST'), /Reconnect Baci/);
  assert.equal(f.state().begins, 0);
  assert.deepEqual(f.state().stored, []);
});

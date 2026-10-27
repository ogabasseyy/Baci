import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createCartQuotaScopedClient } from './scoped-client';

const options = {
  anonKey: 'synthetic-anon-key',
  supabaseUrl: 'https://project.example.test',
  now: new Date('2026-10-27T04:00:00Z'),
  signer: {
    type: 'legacy-secret' as const,
    secret: 'synthetic-quota-signing-secret',
  },
};

function claims(windowMs: number) {
  const client = createCartQuotaScopedClient(
    'private-scoped-key',
    windowMs,
    options
  );
  const runtimeClient = client as unknown as { rest: { headers: Headers } };
  const token = runtimeClient.rest.headers.get('Authorization');
  if (!token?.startsWith('Bearer ')) throw new Error('Missing scoped token');
  return JSON.parse(
    Buffer.from(token.slice(7).split('.')[1], 'base64url').toString()
  ) as Record<string, unknown>;
}

it('mints only a hashed counter capability with exactly sixty seconds of authority', () => {
  const issuedAt = options.now.getTime() / 1000;
  expect(claims(60_000)).toEqual({
    aud: 'authenticated',
    role: 'commerce_cart_quota',
    cart_quota_key: createHash('sha256')
      .update('private-scoped-key')
      .digest('hex'),
    cart_quota_window_ms: 60_000,
    iat: issuedAt,
    exp: issuedAt + 60,
  });
});

it.each([
  1000, 3_600_000,
])('supports the bounded database window: %i', (windowMs) => {
  expect(claims(windowMs).cart_quota_window_ms).toBe(windowMs);
});

it.each([
  0,
  999,
  3_600_001,
  Number.NaN,
])('rejects invalid windows before constructing authority: %i', (windowMs) => {
  expect(() => createCartQuotaScopedClient('key', windowMs, options)).toThrow(
    'Invalid cart quota window'
  );
});

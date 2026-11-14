import { createHmac } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createPublicVerificationHandler } from './public-verification-handler';

const key = Buffer.alloc(32, 7);
const now = 1700000000000;
const body = {
  version: 1,
  nonce: 'a'.repeat(64),
  expiresAt: now + 30000,
  accessToken: 'synthetic.jwt.token',
  approvalId: '11111111-1111-4111-8111-111111111111',
};
function request(value: object = body, signature?: string) {
  const encoded = JSON.stringify(value);
  const signed =
    signature ??
    createHmac('sha256', key)
      .update(`verifier-public/v1\n${encoded}`)
      .digest('hex');
  return new Request('https://verifier.baci-internal.invalid/v1/public', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-baci-verifier-signature': signed,
    },
    body: encoded,
  });
}

it('authenticates a signed one-time request and invokes verification with the owner client', async () => {
  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'synthetic' } },
        error: null,
      })),
    },
  };
  const verify = vi.fn(async () => {});
  const consumeNonce = vi.fn(async () => true);
  const handler = createPublicVerificationHandler({
    key,
    now: () => now,
    consumeNonce,
    resolveUserClient: async () => client as never,
    verify,
  });
  expect((await handler(request())).status).toBe(204);
  expect(verify).toHaveBeenCalledWith(client, body.approvalId);
  expect(consumeNonce).toHaveBeenCalledWith(body.nonce, body.expiresAt);
});

it('rejects tampering, expiry, replays, extra input and invalid users without verifying', async () => {
  const verify = vi.fn(async () => {});
  const handler = createPublicVerificationHandler({
    key,
    now: () => now,
    consumeNonce: async () => false,
    resolveUserClient: async () => {
      throw Error('must not resolve');
    },
    verify,
  });
  expect((await handler(request(body, '0'.repeat(64)))).status).toBe(401);
  expect((await handler(request({ ...body, expiresAt: now - 1 }))).status).toBe(
    401
  );
  expect((await handler(request({ ...body, extra: true }))).status).toBe(400);
  expect((await handler(request())).status).toBe(409);
  const invalid = createPublicVerificationHandler({
    key,
    now: () => now,
    consumeNonce: async () => true,
    resolveUserClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      }) as never,
    verify,
  });
  expect((await invalid(request())).status).toBe(403);
  expect(verify).not.toHaveBeenCalled();
});

it('does not expose internal errors or accept other paths', async () => {
  const handler = createPublicVerificationHandler({
    key,
    now: () => now,
    consumeNonce: async () => true,
    resolveUserClient: async () => {
      throw Error('secret');
    },
    verify: async () => {},
  });
  const result = await handler(request());
  expect(result.status).toBe(403);
  expect(await result.text()).toBe('');
  expect(
    (
      await handler(
        new Request('https://other.example/v1/public', { method: 'POST' })
      )
    ).status
  ).toBe(404);
});

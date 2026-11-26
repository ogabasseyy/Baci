import { createHmac } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { serializeCanonicalOwnerWirePayload } from '@/schemas/experience-owner-wire';
import { createVerifierAttestationHandler } from './attestation-handler';
import { createOwnerVerificationSlots } from './owner-verification-slots';
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
  const canonical = serializeCanonicalOwnerWirePayload(value);
  const signed =
    signature ??
    createHmac('sha256', key)
      .update(`verifier-public/v1\n${canonical}`)
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
  const resolveUserClient = vi.fn(async () => client as never);
  const consumeNonce = vi.fn(async () => true);
  const handler = createPublicVerificationHandler({
    key,
    now: () => now,
    consumeNonce,
    resolveUserClient,
    verify,
  });
  const input = request();
  expect((await handler(input)).status).toBe(204);
  expect(resolveUserClient).toHaveBeenCalledWith(
    body.accessToken,
    input.signal
  );
  expect(verify).toHaveBeenCalledWith(client, body.approvalId, input.signal);
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

it('shares slow verification capacity across signed owner operations', async () => {
  const reserveOwnerWork = createOwnerVerificationSlots();
  const slow = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const publicSlow = Promise.withResolvers<void>();
  const publicStarted = Promise.withResolvers<void>();
  const shared = {
    key,
    now: () => now,
    consumeNonce: async () => true,
    resolveUserClient: async (token: string) =>
      ({
        auth: {
          getUser: async () => ({
            data: { user: { id: token.split('.')[0] } },
            error: null,
          }),
        },
      }) as never,
    reserveOwnerWork,
  };
  const attest = createVerifierAttestationHandler({
    ...shared,
    attest: async () => {
      started.resolve();
      return slow.promise;
    },
  });
  const publicVerify = createPublicVerificationHandler({
    ...shared,
    verify: vi
      .fn(async () => {})
      .mockImplementationOnce(async () => {
        publicStarted.resolve();
        await publicSlow.promise;
      }),
  });
  const attestationBody = serializeCanonicalOwnerWirePayload({
    ...body,
    kind: 'draft',
  });
  const pending = attest(
    new Request('https://verifier.baci-internal.invalid/v1/attest', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-baci-verifier-signature': createHmac('sha256', key)
          .update(`verifier-attest/v1\n${attestationBody}`)
          .digest('hex'),
      },
      body: attestationBody,
    })
  );
  try {
    await started.promise;
    expect(
      (
        await publicVerify(
          request({
            ...body,
            nonce: 'b'.repeat(64),
            accessToken: 'synthetic.new.token',
          })
        )
      ).status
    ).toBe(429);
    const secondOwner = publicVerify(
      request({
        ...body,
        nonce: 'c'.repeat(64),
        accessToken: 'another.jwt.token',
      })
    );
    await publicStarted.promise;
    try {
      expect(
        (
          await publicVerify(
            request({
              ...body,
              nonce: 'e'.repeat(64),
              accessToken: 'third.jwt.token',
            })
          )
        ).status
      ).toBe(429);
    } finally {
      publicSlow.resolve();
      expect((await secondOwner).status).toBe(204);
    }
  } finally {
    slow.resolve();
    await pending;
  }
  expect(
    (await publicVerify(request({ ...body, nonce: 'd'.repeat(64) }))).status
  ).toBe(204);
});

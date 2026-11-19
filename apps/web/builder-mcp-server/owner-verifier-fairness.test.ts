import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { expect, it } from 'vitest';
import { createOwnerAdmission } from './owner-admission';
import { createOwnerInternalNodeServer } from './owner-internal-node';
import { send } from './owner-preview-http.test-support';

it('shares one verifier slot per signed owner across lanes, retaining it until disconnected work settles', async () => {
  const key = Buffer.alloc(32, 2);
  const first = randomUUID();
  const second = randomUUID();
  const work = Promise.withResolvers<void>();
  const started = Promise.withResolvers<AbortSignal>();
  const server = createOwnerInternalNodeServer({
    ownerAttestation: async (request) => {
      started.resolve(request.signal);
      await work.promise;
      return new Response(null, { status: 204 });
    },
    ownerPublicVerification: async () => new Response(null, { status: 204 }),
    ownerAttestationAdmission: createOwnerAdmission(key, 'verifier-attest/v1'),
    ownerPublicVerificationAdmission: createOwnerAdmission(
      key,
      'verifier-public/v1'
    ),
  });
  const port = await server.listen(0);
  async function signed(lane: 'public' | 'attest', owner: string) {
    const accessToken = await new SignJWT({ session_id: randomUUID() })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(owner)
      .sign(key);
    const body = JSON.stringify({
      version: 1,
      nonce: randomBytes(32).toString('hex'),
      expiresAt: Date.now() + 30_000,
      accessToken,
      approvalId: randomUUID(),
      ...(lane === 'attest' ? { kind: 'draft' } : {}),
    });
    const signature = createHmac('sha256', key)
      .update(`verifier-${lane}/v1\n${body}`)
      .digest('hex');
    return {
      path: `/internal/owner/${lane}`,
      body,
      signature,
      signatureHeader: 'x-baci-verifier-signature',
    };
  }
  const controller = new AbortController();
  const pending = send(port, {
    ...(await signed('attest', first)),
    signal: controller.signal,
  }).catch(() => undefined);
  try {
    const signal = await started.promise;
    const sameOwner = await signed('public', first);
    expect((await send(port, sameOwner)).status).toBe(429);
    expect((await send(port, await signed('public', second))).status).toBe(204);
    const aborted = new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true })
    );
    controller.abort();
    await aborted;
    expect((await send(port, sameOwner)).status).toBe(429);
    await pending;
    work.resolve();
    expect((await send(port, sameOwner)).status).toBe(204);
  } finally {
    work.resolve();
    await pending;
    await server.close();
  }
});

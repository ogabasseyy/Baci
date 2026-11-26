import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { expect, it } from 'vitest';
import { serializeExperienceOwnerWireMessage } from '../src/schemas/experience-owner-wire';
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
    const domain =
      lane === 'attest' ? 'verifier-attest/v1' : 'verifier-public/v1';
    const body = serializeExperienceOwnerWireMessage(domain, {
      version: 1,
      nonce: randomBytes(32).toString('hex'),
      expiresAt: Date.now() + 30_000,
      accessToken,
      approvalId: randomUUID(),
      ...(lane === 'attest' ? { kind: 'draft' } : {}),
    });
    const signature = createHmac('sha256', key)
      .update(`${domain}\n${body}`)
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

it('limits owner preview to one active slot per owner without blocking other owners or verifier lanes', async () => {
  const previewKey = Buffer.alloc(32, 3);
  const verifierKey = Buffer.alloc(32, 4);
  const first = randomUUID();
  const second = randomUUID();
  const previewWork = Promise.withResolvers<void>();
  const previewStarted = Promise.withResolvers<void>();
  const secondPreviewStarted = Promise.withResolvers<void>();
  let previewCalls = 0;
  const server = createOwnerInternalNodeServer({
    ownerPreview: async () => {
      previewCalls += 1;
      if (previewCalls === 1) {
        previewStarted.resolve();
        await previewWork.promise;
      } else if (previewCalls === 2) {
        secondPreviewStarted.resolve();
      }
      return Response.json({ ok: true });
    },
    ownerAttestation: async () => new Response(null, { status: 204 }),
    ownerPreviewAdmission: createOwnerAdmission(previewKey, 'owner-preview/v1'),
    ownerAttestationAdmission: createOwnerAdmission(
      verifierKey,
      'verifier-attest/v1'
    ),
  });
  const port = await server.listen(0);
  async function signedPreview(owner: string) {
    const accessToken = await new SignJWT({ session_id: randomUUID() })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(owner)
      .sign(previewKey);
    const body = serializeExperienceOwnerWireMessage('owner-preview/v1', {
      version: 1,
      nonce: randomBytes(32).toString('hex'),
      expiresAt: Date.now() + 30_000,
      accessToken,
      input: { merchantId: randomUUID(), buildId: randomUUID(), routeId: '/' },
    });
    const signature = createHmac('sha256', previewKey)
      .update(`owner-preview/v1\n${body}`)
      .digest('hex');
    return {
      path: '/internal/owner/preview',
      body,
      signature,
      signatureHeader: 'x-baci-owner-signature',
    };
  }
  async function signedAttest(owner: string) {
    const accessToken = await new SignJWT({ session_id: randomUUID() })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(owner)
      .sign(verifierKey);
    const body = serializeExperienceOwnerWireMessage('verifier-attest/v1', {
      version: 1,
      nonce: randomBytes(32).toString('hex'),
      expiresAt: Date.now() + 30_000,
      accessToken,
      approvalId: randomUUID(),
      kind: 'draft',
    });
    const signature = createHmac('sha256', verifierKey)
      .update(`verifier-attest/v1\n${body}`)
      .digest('hex');
    return {
      path: '/internal/owner/attest',
      body,
      signature,
      signatureHeader: 'x-baci-verifier-signature',
    };
  }
  const activePreview = send(port, await signedPreview(first));
  try {
    await previewStarted.promise;
    const sameOwnerRetry = await signedPreview(first);
    expect((await send(port, sameOwnerRetry)).status).toBe(429);
    expect((await send(port, await signedAttest(first))).status).toBe(204);
    const otherOwnerPreview = send(port, await signedPreview(second));
    await secondPreviewStarted.promise;
    expect((await otherOwnerPreview).status).toBe(200);
    previewWork.resolve();
    expect((await activePreview).status).toBe(200);
    expect((await send(port, sameOwnerRetry)).status).toBe(200);
  } finally {
    previewWork.resolve();
    await activePreview.catch(() => undefined);
    await server.close();
  }
});

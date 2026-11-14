import { expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  nonce: vi.fn(),
  record: vi.fn(),
  handler: vi.fn(),
  listen: vi.fn(),
  resolver: vi.fn(),
  verifier: vi.fn(),
  load: vi.fn(),
  worker: vi.fn(),
  capture: vi.fn(),
  buildRecord: vi.fn(),
  buildHandler: vi.fn(),
  buildVerifier: vi.fn(),
  captureHandler: vi.fn(),
  publicHandler: vi.fn(),
  publicCoordinator: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../../tools/experience-verifier/nonce-store', () => ({
  createVerifierNonceStore: f.nonce,
}));
vi.mock('../../tools/experience-verifier/approval-recorder', () => ({
  createVerifierApprovalRecorder: f.record,
}));
vi.mock('../../tools/experience-verifier/attestation-handler', () => ({
  createVerifierAttestationHandler: f.handler,
}));
vi.mock('../../tools/experience-verifier/listener', () => ({
  startVerifierListener: f.listen,
}));
vi.mock('@/lib/experience/owner-preview-user-client', () => ({
  createOwnerPreviewUserClientResolver: f.resolver,
}));
vi.mock('@/lib/experience/independent-approval-verifier', () => ({
  createIndependentApprovalVerifier: f.verifier,
}));
vi.mock('@/lib/experience/approval-service', () => ({
  loadDraftApproval: f.load,
}));
vi.mock('@/lib/experience/publication-service', () => ({
  loadLifecycleApproval: f.load,
}));
vi.mock('../../tools/experience-verifier/capture-worker', () => ({
  createVerifierCaptureWorker: f.worker,
}));
vi.mock('../../tools/experience-verifier/approval-capture', () => ({
  createApprovalCapture: f.capture,
}));
vi.mock('../../tools/experience-verifier/build-recorder', () => ({
  createVerifierBuildRecorder: f.buildRecord,
}));
vi.mock('../../tools/experience-verifier/build-handler', () => ({
  createVerifierBuildHandler: f.buildHandler,
}));
vi.mock('../../tools/experience-verifier/build-verifier', () => ({
  createIndependentBuildVerifier: f.buildVerifier,
}));
vi.mock('../../tools/experience-verifier/capture-handler', () => ({
  createVerifierCaptureHandler: f.captureHandler,
}));
vi.mock('../../tools/experience-verifier/public-verification-handler', () => ({
  createPublicVerificationHandler: f.publicHandler,
}));
vi.mock(
  '../../tools/experience-verifier/public-verification-coordinator',
  () => ({ createPublicVerificationCoordinator: f.publicCoordinator })
);

import { startVerifierService } from '../../tools/experience-verifier/service';

it('starts with restricted nonce and proof stores and refuses a reused runner key', async () => {
  const nonce = vi.fn();
  const record = vi.fn();
  const handler = vi.fn();
  const close = vi.fn();
  f.nonce.mockResolvedValueOnce(nonce);
  f.record.mockResolvedValueOnce(record);
  f.buildRecord.mockResolvedValueOnce(vi.fn());
  f.resolver.mockReturnValueOnce(vi.fn());
  f.verifier.mockReturnValueOnce({ attest: vi.fn() });
  f.handler.mockReturnValueOnce(handler);
  f.buildHandler.mockReturnValueOnce(vi.fn());
  f.captureHandler.mockReturnValueOnce(vi.fn());
  f.listen.mockResolvedValueOnce({ close });
  const config = {
    pool: {},
    key: new Uint8Array(32).fill(1),
    port: 8891,
    runner: {
      endpoint: 'https://runner.runtime.test/v1/execute',
      key: new Uint8Array(32).fill(2),
      toolchainDigest: 'a'.repeat(64),
    },
    previewOrigin: 'https://builder.baci.test',
    executionOrigin: 'https://output.runtime.test',
    supabase: {
      url: 'https://project.supabase.co',
      anonKey: 'sb_publishable_synthetic',
    },
    canonicalBase: (slug: string) => `https://${slug}.merchant.test/${slug}`,
  } as unknown as Parameters<typeof startVerifierService>[0];
  const service = await startVerifierService(config);
  expect(f.handler).toHaveBeenCalledWith(
    expect.objectContaining({ key: config.key, consumeNonce: nonce })
  );
  expect(f.listen).toHaveBeenCalledWith(
    handler,
    8891,
    expect.any(Function),
    expect.any(Function)
  );
  const capture = f.verifier.mock.calls.at(-1)?.[0].capture;
  const id = '11111111-1111-4111-8111-111111111111';
  const binding = {
    approvalId: id,
    kind: 'draft',
    buildId: id,
    effectDigest: 'a'.repeat(64),
  };
  f.load.mockResolvedValue({
    status: 'confirmation-required',
    approvalId: id,
    merchantId: id,
    buildId: id,
    effectDigest: binding.effectDigest,
  });
  let host = 'https://evil.example';
  const client = {
    auth: { getUser: async () => ({ data: { user: { id } }, error: null }) },
    rpc: async () => ({ data: true, error: null }),
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data:
            table === 'merchants'
              ? { slug: 'synthetic' }
              : { host_origin: host },
          error: null,
        }),
      };
      return q;
    },
  };
  await expect(capture(client, binding)).rejects.toThrow('APPROVAL_MISMATCH');
  expect(f.worker).not.toHaveBeenCalled();
  host = 'https://synthetic.merchant.test';
  const worker = vi.fn();
  f.worker.mockResolvedValueOnce(worker);
  f.capture.mockReturnValueOnce(vi.fn(async () => ({ ok: true })));
  await expect(capture(client, binding)).resolves.toEqual({ ok: true });
  expect(f.worker).toHaveBeenCalledWith(
    expect.objectContaining({ hostOrigin: host })
  );
  await service.close();
  expect(close).toHaveBeenCalledOnce();
  await expect(
    startVerifierService({
      ...config,
      runner: { ...config.runner, key: config.key },
    })
  ).rejects.toThrow('INVALID_VERIFIER_CONFIG');
});

it('wires public verification only when a trusted observer is explicitly supplied', async () => {
  const nonce = vi.fn();
  const resolveUser = vi.fn();
  const observe = vi.fn();
  const publicHandler = vi.fn();
  const verify = vi.fn(async () => ({ status: 'verified' }));
  f.nonce.mockResolvedValueOnce(nonce);
  f.record.mockResolvedValueOnce(vi.fn());
  f.buildRecord.mockResolvedValueOnce(vi.fn());
  f.resolver.mockReturnValueOnce(resolveUser);
  f.verifier.mockReturnValueOnce({ attest: vi.fn() });
  f.handler.mockReturnValueOnce(vi.fn());
  f.buildHandler.mockReturnValueOnce(vi.fn());
  f.captureHandler.mockReturnValueOnce(vi.fn());
  f.publicHandler.mockReturnValueOnce(publicHandler);
  f.publicCoordinator.mockResolvedValueOnce(verify);
  f.listen.mockResolvedValueOnce({ close: vi.fn() });
  const config = {
    pool: {},
    key: new Uint8Array(32).fill(1),
    port: 8891,
    runner: {
      endpoint: 'https://runner.runtime.test/v1/execute',
      key: new Uint8Array(32).fill(2),
      toolchainDigest: 'a'.repeat(64),
    },
    previewOrigin: 'https://builder.baci.test',
    executionOrigin: 'https://output.runtime.test',
    supabase: {
      url: 'https://project.supabase.co',
      anonKey: 'sb_publishable_synthetic',
    },
    canonicalBase: () => 'https://shop.merchant.test',
    publicVerification: { rootDomain: 'merchant.test', observe },
  } as unknown as Parameters<typeof startVerifierService>[0];
  const service = await startVerifierService(config);
  expect(f.listen.mock.calls.at(-1)?.[4]).toBe(publicHandler);
  const settings = f.publicHandler.mock.calls.at(-1)?.[0];
  expect(settings).toMatchObject({
    key: config.key,
    consumeNonce: nonce,
    resolveUserClient: resolveUser,
  });
  const owner = {};
  await settings.verify(owner, 'approval');
  expect(f.publicCoordinator).toHaveBeenCalledWith(
    expect.objectContaining({
      owner,
      observe,
      pool: config.pool,
      rootDomain: 'merchant.test',
    })
  );
  expect(verify).toHaveBeenCalledWith('approval');
  await service.close();
});

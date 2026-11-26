import { expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  end: vi.fn(async () => {}),
  poolConfig: vi.fn(),
  close: vi.fn(async () => {}),
  nonce: vi.fn(async () => true),
  readRenderer: vi.fn(async () => null),
  boot: vi.fn(),
  client: {},
  attest: vi.fn((_settings: { key: Uint8Array; fetch?: typeof fetch }) =>
    vi.fn()
  ),
  forward: vi.fn(
    async (_request: Request) => new Response(null, { status: 204 })
  ),
}));
vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => f.client }));
vi.mock('pg', () => ({
  Pool: class {
    constructor(options: unknown) {
      f.poolConfig(options);
    }
    end = f.end;
  },
}));
vi.mock('../builder-auth/owner-preview-nonce', async (original) => ({
  ...(await original<typeof import('../builder-auth/owner-preview-nonce')>()),
  createOwnerPreviewNonceStore: async () => f.nonce,
}));
vi.mock('../experience-verifier/loopback-forwarder', () => ({
  createVerifierLoopbackForwarder: () => f.forward,
}));
vi.mock('@/lib/experience/verifier-attestation-client', () => ({
  createVerifierAttestationClient: f.attest,
}));
vi.mock('./published-renderer-reader', async (original) => ({
  ...(await original<typeof import('./published-renderer-reader')>()),
  createPublishedRendererReader: async () => f.readRenderer,
}));
vi.mock('./boot', () => ({ startProductionBuilderFromPrivateConfig: f.boot }));

import { startProductionBuilder } from './production-start';

const key = (n: number) => Buffer.alloc(32, n).toString('base64url');
const config = {
  port: 43100,
  deliveryPort: 43101,
  authPort: 43103,
  ownerPort: 43104,
  verifierPort: 43102,
  verifierKey: key(1),
  previewKey: key(2),
  buildKey: key(3),
  runner: {
    endpoint: 'https://runner.example.com/v1/execute',
    key: key(4),
    toolchainDigest: 'a'.repeat(64),
  },
  previewDatabaseUrl:
    'postgresql://baci_owner_preview_login:secret@db.example.com:5432/postgres',
  rendererDatabaseUrl:
    'postgresql://baci_experience_renderer_reader_login:secret@db.example.com:5432/postgres',
  hostOrigin: 'https://preview.example.com',
  executionOrigin: 'https://execution.other-example.com',
  rootDomain: 'example.com',
  supabase: {
    url: 'https://project.supabase.co',
    anonKey: 'sb_publishable_12345678',
  },
};

it('wires restricted nonce admission, independent verifier and fixed artifact storage; closes both resources', async () => {
  f.boot.mockResolvedValueOnce({ close: f.close });
  const service = await startProductionBuilder(config);
  expect(f.poolConfig).toHaveBeenCalledWith(
    expect.objectContaining({
      options: '-c role=baci_owner_preview_nonce',
      connectionTimeoutMillis: 3000,
      statement_timeout: 2000,
      lock_timeout: 1000,
      query_timeout: 3000,
    })
  );
  const settings = f.boot.mock.calls.at(-1)?.[0];
  expect(settings.ownerPort).toBe(43104);
  expect(settings.backgroundWorker).toBeUndefined();
  expect(settings.ownerBridge.consumeNonce).toBe(f.nonce);
  expect(settings.integration.artifactDirectory).toBe(
    '/var/lib/baci-builder/artifacts'
  );
  expect(settings.integration.publicClient).toBe(f.client);
  expect(settings.integration.readPublishedRenderer).toBe(f.readRenderer);
  expect(settings.verifierKey).toEqual(Buffer.alloc(32, 1));
  expect(f.attest).toHaveBeenCalledWith({
    key: Buffer.alloc(32, 1),
    fetch: expect.any(Function),
  });
  const fetch = f.attest.mock.calls.at(-1)?.[0]?.fetch;
  if (!fetch) throw Error('MISSING_LOCAL_VERIFIER_FETCH');
  const response = await fetch(
    'https://owner.baci-internal.invalid/internal/owner/attest',
    { method: 'POST', body: '{}' }
  );
  expect(response.status).toBe(204);
  expect(f.forward.mock.calls.at(-1)?.[0].url).toBe(
    'https://verifier.baci-internal.invalid/v1/attest'
  );
  await expect(fetch('https://other.invalid/attest')).rejects.toThrow(
    'INVALID_VERIFIER_TARGET'
  );
  await expect(
    settings.integration.approval.confirmPublication()
  ).rejects.toThrow('PUBLIC_VERIFIER_NOT_INSTALLED');
  await service.close();
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.end).toHaveBeenCalledTimes(2);
});

it('installs the scheduler only when the private operator config opts in', async () => {
  f.boot.mockResolvedValueOnce({ close: f.close });
  const service = await startProductionBuilder({
    ...config,
    backgroundBuilds: true,
  });
  expect(f.boot.mock.calls.at(-1)?.[0].backgroundWorker).toEqual({
    schedule: expect.any(Function),
  });
  await service.close();
});

it('closes the restricted database pool when the stack fails to start', async () => {
  f.end.mockClear();
  f.boot.mockRejectedValueOnce(Error('private detail'));
  await expect(startProductionBuilder(config)).rejects.toMatchObject({
    message: 'BUILDER_STARTUP_FAILED',
    phase: 'stack',
  });
  expect(f.end).toHaveBeenCalledTimes(2);
});

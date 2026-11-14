import { expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  end: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  nonce: vi.fn(async () => true),
  boot: vi.fn(),
  client: {},
}));
vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => f.client }));
vi.mock('pg', () => ({
  Pool: class {
    end = f.end;
  },
}));
vi.mock('../builder-auth/owner-preview-nonce', () => ({
  createOwnerPreviewNonceStore: async () => f.nonce,
}));
vi.mock('@/lib/experience/verifier-attestation-client', () => ({
  createVerifierAttestationClient: () => vi.fn(),
}));
vi.mock('./boot', () => ({ startProductionBuilderFromPrivateConfig: f.boot }));

import { startProductionBuilder } from './production-start';

const key = (n: number) => Buffer.alloc(32, n).toString('base64url');
const config = {
  port: 43100,
  deliveryPort: 43101,
  authPort: 43103,
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
  const settings = f.boot.mock.calls.at(-1)?.[0];
  expect(settings.ownerBridge.consumeNonce).toBe(f.nonce);
  expect(settings.integration.artifactDirectory).toBe(
    '/var/lib/baci-builder/artifacts'
  );
  expect(settings.integration.publicClient).toBe(f.client);
  expect(settings.verifierKey).toEqual(Buffer.alloc(32, 1));
  await expect(
    settings.integration.approval.confirmPublication()
  ).rejects.toThrow('PUBLIC_VERIFIER_NOT_INSTALLED');
  await service.close();
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.end).toHaveBeenCalledOnce();
});

it('closes the restricted database pool when the stack fails to start', async () => {
  f.end.mockClear();
  f.boot.mockRejectedValueOnce(Error('private detail'));
  await expect(startProductionBuilder(config)).rejects.toThrow(
    'BUILDER_STARTUP_FAILED'
  );
  expect(f.end).toHaveBeenCalledOnce();
});

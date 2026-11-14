import { expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  bind: vi.fn(),
  load: vi.fn(),
  read: vi.fn(),
  manifest: vi.fn(),
  canonical: vi.fn(),
}));
vi.mock('@/lib/experience/publication-service', () => ({
  loadLifecycleApproval: f.load,
}));
vi.mock('@/lib/experience/public-output-reader', () => ({
  createPublicOutputReader: () => ({ read: f.read, manifest: f.manifest }),
}));
vi.mock('@/lib/experience/canonical-domain', () => ({
  validateCanonicalRootDomain: vi.fn(),
  resolveCanonicalBase: f.canonical,
}));
vi.mock('./public-head-binding', () => ({ bindPublicHead: f.bind }));

import { createPublicHeadResolver } from './public-head-resolver';

it('uses owner-scoped reads and a separate public projection for a receipt', async () => {
  const filters: string[] = [];
  const query = {
    select: () => query,
    eq: (name: string, value: string) => {
      filters.push(`${name}:${value}`);
      return query;
    },
    maybeSingle: async () => ({
      data: { slug: 'synthetic', build_digest: 'digest' },
      error: null,
    }),
  };
  const owner = { from: vi.fn(() => query) };
  const publicClient = {};
  f.bind.mockImplementationOnce(async (_id, deps) => {
    await deps.loadReceipt('approval');
    await deps.loadMerchant('merchant');
    await deps.loadBuildDigest('merchant', 'build');
    await deps.canonicalBase('synthetic');
    return 'bound';
  });
  await expect(
    createPublicHeadResolver(
      owner as never,
      publicClient as never,
      'example.com'
    )('approval')
  ).resolves.toBe('bound');
  expect(f.load).toHaveBeenCalledWith(owner, 'approval');
  expect(filters).toEqual(['id:merchant', 'merchant_id:merchant', 'id:build']);
  expect(f.canonical).toHaveBeenCalledWith(
    publicClient,
    'synthetic',
    'example.com'
  );
});

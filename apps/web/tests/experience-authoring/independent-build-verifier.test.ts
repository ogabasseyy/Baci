import { expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  owner: vi.fn(),
  job: vi.fn(),
  parse: vi.fn(),
  sourceDigest: vi.fn(),
  unpack: vi.fn(),
  qualify: vi.fn(),
  assets: vi.fn(),
  budget: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/experience/authorization', () => ({
  requireExperienceOwner: f.owner,
}));
vi.mock('@/lib/experience/repository', () => ({
  createExperienceRepository: () => ({ loadOwnedJob: f.job }),
}));
vi.mock('@/schemas/experience-manifest', () => ({
  parseExperienceManifest: f.parse,
}));
vi.mock('@baci/shared/experience', () => ({ sourceDigest: f.sourceDigest }));
vi.mock('../../tools/experience-runner/prerender-artifacts', () => ({
  unpackPrerenderBuild: f.unpack,
}));
vi.mock('../../tools/experience-runner/private-build-payload', () => ({
  packPrivateBuild: vi.fn(() => ({})),
}));
vi.mock('@/lib/experience/qualify-build-render', () => ({
  qualifyBuildRender: f.qualify,
}));
vi.mock('@/lib/experience/asset-service', () => ({
  loadOfflineAssets: f.assets,
}));
vi.mock('@/lib/experience/candidate-performance-budget', () => ({
  assertCandidatePerformanceBudget: f.budget,
}));

import { createIndependentBuildVerifier } from '../../tools/experience-verifier/build-verifier';

const id = '11111111-1111-4111-8111-111111111111';
const digest = 'a'.repeat(64);
function fixture() {
  const rows: Record<string, unknown> = {
    merchants: { slug: 'synthetic' },
    experience_artifacts: { manifest: {} },
  };
  const client = {
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: rows[table], error: null }),
      };
      return q;
    },
  };
  const ctx = { merchantId: id, supabase: client };
  f.owner.mockImplementation(async (input) => input);
  f.job.mockResolvedValue({
    id,
    artifact_id: id,
    source_digest: digest,
    attempt_nonce: id,
    status: 'running',
    expires_at: '2099-01-01T00:00:00Z',
  });
  f.parse.mockReturnValue({
    routes: [{ path: '/', view: 'home' }],
    assets: [],
  });
  f.sourceDigest.mockReturnValue(digest);
  f.unpack.mockReturnValue({
    client: {
      digest,
      hostOrigin: 'https://synthetic.merchant.test',
      javascript: '',
      css: '',
    },
    renderer: { digest, javascript: '', css: '' },
  });
  f.assets.mockResolvedValue([]);
  f.qualify.mockResolvedValue([{}]);
  const execute = vi.fn(async (kind: string) => ({
    output:
      kind === 'prerender'
        ? { format: 'baci-prerender/v1', html: '<main />' }
        : {},
    jobId: id,
    wallMs: 1,
  }));
  const record = vi.fn(async () => {});
  const canonicalBase = vi.fn(async () => 'https://synthetic.merchant.test');
  const verifier = createIndependentBuildVerifier({
    execute: execute as never,
    record,
    bootstrap: vi.fn(async () => ({})) as never,
    canonicalBase,
    previewOrigin: 'https://builder.baci.test',
    executionOrigin: 'https://output.runtime.test',
  });
  const input = {
    jobId: id,
    attemptNonce: id,
    buildDigest: digest,
    receiptDigest: 'b'.repeat(64),
    hostOrigin: 'https://synthetic.merchant.test',
  };
  return { ctx, verifier, input, execute, record, canonicalBase };
}
it('records only after independent recompilation and browser qualification', async () => {
  const x = fixture();
  await x.verifier(x.ctx as never, x.input);
  expect(
    x.execute.mock.calls.filter(([kind]) => kind === 'prerender-build')
  ).toHaveLength(2);
  expect(f.qualify).toHaveBeenCalledOnce();
  expect(x.record).toHaveBeenCalledWith(
    expect.objectContaining({ merchantId: id, buildDigest: digest })
  );
});
it('does not record if the merchant domain changes during qualification', async () => {
  const x = fixture();
  x.canonicalBase
    .mockResolvedValueOnce('https://synthetic.merchant.test')
    .mockResolvedValueOnce('https://changed.example.com');
  await expect(x.verifier(x.ctx as never, x.input)).rejects.toThrow(
    'BUILD_FAILED'
  );
  expect(x.record).not.toHaveBeenCalled();
});
it('never records a caller-selected digest or a stale attempt', async () => {
  const x = fixture();
  await expect(
    x.verifier(x.ctx as never, { ...x.input, buildDigest: 'c'.repeat(64) })
  ).rejects.toThrow('BUILD_FAILED');
  expect(x.record).not.toHaveBeenCalled();
  f.job.mockResolvedValueOnce({
    id,
    artifact_id: id,
    source_digest: digest,
    attempt_nonce: '22222222-2222-4222-8222-222222222222',
    status: 'running',
    expires_at: '2099-01-01T00:00:00Z',
  });
  await expect(x.verifier(x.ctx as never, x.input)).rejects.toThrow(
    'BUILD_FAILED'
  );
  expect(x.record).not.toHaveBeenCalled();
});

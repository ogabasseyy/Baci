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
vi.mock('../experience-runner/prerender-artifacts', () => ({
  unpackPrerenderBuild: f.unpack,
}));
vi.mock('../experience-runner/private-build-payload', () => ({
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

import { createIndependentBuildVerifier } from './build-verifier';

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
  const withSignal = vi.fn(
    (kind: string, _payload: unknown, _signal: AbortSignal) => execute(kind)
  );
  const record = vi.fn(async () => {});
  const canonicalBase = vi.fn(async () => 'https://synthetic.merchant.test');
  const verifier = createIndependentBuildVerifier({
    execute: Object.assign(execute, { withSignal }) as never,
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
  return {
    ctx,
    rows,
    verifier,
    input,
    execute,
    withSignal,
    record,
    canonicalBase,
  };
}
it('records only after independent recompilation and browser qualification', async () => {
  const x = fixture();
  await x.verifier(x.ctx as never, x.input);
  expect(
    x.execute.mock.calls.filter(([kind]) => kind === 'prerender-build')
  ).toHaveLength(2);
  expect(f.qualify).toHaveBeenCalledOnce();
  expect(x.record).toHaveBeenCalledWith(
    expect.objectContaining({ merchantId: id, buildDigest: digest }),
    expect.objectContaining({
      javascript: expect.any(String),
      digest: expect.any(String),
    })
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

it('passes the request abort to the active capture and skips subsequent captures and recording', async () => {
  const x = fixture();
  const controller = new AbortController();
  const reason = Error('synthetic cancellation');
  x.withSignal.mockImplementation(async (kind, _payload, signal) => {
    if (kind === 'capture') {
      const cancelled = new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
      controller.abort(reason);
      return cancelled;
    }
    return x.execute(kind);
  });
  f.qualify.mockImplementationOnce(async ({ execute }) => {
    await execute('capture', { width: 390 });
    await execute('capture', { width: 1440 });
  });

  await expect(
    x.verifier(x.ctx as never, x.input, controller.signal)
  ).rejects.toBe(reason);
  expect(x.withSignal.mock.calls.map(([kind]) => kind)).toEqual([
    'prerender-build',
    'prerender-build',
    'prerender',
    'capture',
  ]);
  expect(x.withSignal).toHaveBeenLastCalledWith(
    'capture',
    { width: 390 },
    controller.signal
  );
  expect(x.record).not.toHaveBeenCalled();
});

it('reconciles a duplicate write only when the exact owner-visible proof exists', async () => {
  const x = fixture();
  const duplicate = Object.assign(Error('duplicate'), { code: '23505' });
  x.record.mockRejectedValueOnce(duplicate);
  await expect(x.verifier(x.ctx as never, x.input)).rejects.toBe(duplicate);
  x.rows.experience_evidence = { id };
  x.record.mockRejectedValueOnce(duplicate);
  await expect(x.verifier(x.ctx as never, x.input)).resolves.toBeUndefined();
});

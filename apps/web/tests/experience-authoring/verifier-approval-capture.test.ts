import { expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/experience/approval-service', () => ({
  loadDraftApproval: f.load,
}));
vi.mock('@/lib/experience/publication-service', () => ({
  loadLifecycleApproval: f.load,
}));

import { createApprovalCapture } from '../../tools/experience-verifier/approval-capture';

const id = '11111111-1111-4111-8111-111111111111';
const buildDigest = 'a'.repeat(64);
const effectDigest = 'b'.repeat(64);
const receipt = 'c'.repeat(64);
const imageDigest = 'd'.repeat(64);
const manifest = {
  format: 'baci.experience/v2',
  runtime: 'react-browser-sandbox/v1',
  sdkVersion: 'commerce-bridge/v1',
  entry: 'app.tsx',
  files: [{ path: 'app.tsx', content: '' }],
  packages: [],
  routes: [
    { path: '/', view: 'home' },
    { path: '/about', view: 'editorial' },
  ],
  assets: [],
  capabilities: ['navigation'],
};
function fixture() {
  f.load.mockResolvedValue({
    status: 'confirmation-required',
    approvalId: id,
    merchantId: id,
    buildId: id,
    evidenceId: id,
    effectDigest,
  });
  const rows: Record<string, unknown> = {
    experience_builds: {
      job_id: id,
      build_digest: buildDigest,
      host_origin: 'https://shop.synthetic.test',
    },
    experience_jobs: {
      artifact_id: id,
      attempt_nonce: id,
      status: 'finalized',
    },
    experience_artifacts: { manifest },
    experience_evidence: { id, receipt_digest: receipt },
    experience_snapshots: {
      build_id: id,
      build_digest: buildDigest,
      evidence_digest: imageDigest,
    },
  };
  const client = {
    from: vi.fn((table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: rows[table], error: null }),
      };
      return q;
    }),
  };
  const worker = vi.fn(async (_ctx: unknown, _input: { routeId: string }) => ({
    evidenceId: id,
    buildId: id,
    buildDigest,
    previewUrl: 'https://builder.synthetic.test/',
  }));
  return {
    rows,
    client,
    worker,
    capture: createApprovalCapture(worker as never),
  };
}
it('captures every declared route and binds the proof to the owner build receipt', async () => {
  const x = fixture();
  const result = await x.capture(x.client as never, {
    approvalId: id,
    kind: 'draft',
    buildId: id,
    effectDigest,
  });
  expect(result).toMatchObject({
    buildId: id,
    buildDigest,
    effectDigest,
    artifactReceipt: receipt,
    routes: ['/', '/about'],
  });
  expect(x.worker).toHaveBeenCalledTimes(2);
  expect(x.worker.mock.calls.map(([, input]) => input.routeId)).toEqual([
    '/',
    '/about',
  ]);
});
it('fails closed when the stored build attestation differs from the approval', async () => {
  const x = fixture();
  x.rows.experience_evidence = {
    id: '22222222-2222-4222-8222-222222222222',
    receipt_digest: receipt,
  };
  await expect(
    x.capture(x.client as never, {
      approvalId: id,
      kind: 'draft',
      buildId: id,
      effectDigest,
    })
  ).rejects.toThrow('APPROVAL_MISMATCH');
  expect(x.worker).not.toHaveBeenCalled();
});

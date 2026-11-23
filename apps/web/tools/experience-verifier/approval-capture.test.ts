import { expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/lib/experience/approval-service', () => ({
  loadDraftApproval: vi.fn(),
}));
vi.mock('@/lib/experience/publication-service', () => ({
  loadLifecycleApproval: vi.fn(),
}));
vi.mock('@/schemas/experience-manifest', () => ({
  parseExperienceManifest: (value: unknown) => value,
}));

import { loadDraftApproval } from '@/lib/experience/approval-service';
import { createApprovalCapture } from './approval-capture';

it('reuses the same capture keys after a lost attestation response and separates routes and effects', async () => {
  const binding = {
    kind: 'draft' as const,
    approvalId: 'approval',
    buildId: 'build',
    effectDigest: 'effect-a',
  };
  const approval = {
    ...binding,
    status: 'confirmation-required',
    merchantId: 'merchant',
    evidenceId: 'build-evidence',
  };
  vi.mocked(loadDraftApproval).mockResolvedValue(approval as never);
  const rows: Record<string, unknown> = {
    experience_builds: {
      job_id: 'job',
      build_digest: 'digest',
      host_origin: 'https://synthetic.test',
    },
    experience_jobs: {
      artifact_id: 'artifact',
      attempt_nonce: 'nonce',
      status: 'finalized',
    },
    experience_artifacts: {
      manifest: { routes: [{ path: '/' }, { path: '/cart' }] },
    },
    experience_evidence: { id: 'build-evidence', receipt_digest: 'receipt' },
    experience_snapshots: {
      build_id: 'build',
      build_digest: 'digest',
      evidence_digest: 'snapshot',
    },
  };
  const from = (table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: rows[table], error: null }),
    };
    return query;
  };
  const keys: string[] = [];
  const capture = createApprovalCapture((async (_ctx, input, replay) => {
    expect(replay).toBe('approval');
    keys.push(z.uuid().parse(input.idempotencyKey));
    return { evidenceId: 'snapshot' };
  }) as Parameters<typeof createApprovalCapture>[0]);
  const client = { from } as never;
  await capture(client, binding);
  await capture(client, binding);
  expect(keys.slice(0, 2)).toEqual(keys.slice(2, 4));
  expect(keys[0]).not.toBe(keys[1]);

  approval.effectDigest = 'effect-b';
  await capture(client, { ...binding, effectDigest: approval.effectDigest });
  expect(keys[4]).not.toBe(keys[0]);
});

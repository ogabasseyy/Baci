import { expect, it, vi } from 'vitest';
import type { BuildSupervisorTestFixture } from './local-build-supervisor.test';

export function registerBuildCapacityCase(fixture: BuildSupervisorTestFixture) {
  const { f, context, deps, validCandidate, runExperienceBuild } = fixture;
  it('leaves a linked attempt recoverable when verifier capacity stays busy', async () => {
    const candidate = validCandidate();
    const execute = vi.fn(async (kind: string) => ({
      jobId: 'synthetic',
      output:
        kind === 'compile'
          ? candidate
          : {
              status: 'passed',
              buildDigest: candidate.digest,
              screenshot: Buffer.from('89504e470d0a1a0a', 'hex').toString(
                'base64'
              ),
            },
    }));
    const original = context as unknown as {
      merchantId: string;
      supabase: object;
    };
    const rpc = vi.fn(async (_name: string) => ({ data: true, error: null }));
    const linked = {
      ...original,
      identity: { connectionId: 'connection', grantVersion: 1 },
      supabase: { ...original.supabase, rpc },
    };
    const input = deps(execute);
    input.recordVerifiedEvidence.mockRejectedValueOnce(Error('VERIFIER_BUSY'));
    await expect(
      runExperienceBuild(
        linked as never,
        { jobId: 'j', idempotencyKey: 'i' },
        input
      )
    ).rejects.toThrow('VERIFIER_BUSY');
    expect(rpc.mock.calls.map(([name]) => name)).toContain(
      'experience_renew_build_lease'
    );
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
      'experience_fail_build'
    );
    expect(f.finalize).not.toHaveBeenCalled();
  });
}

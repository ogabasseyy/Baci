import { expect, it, vi } from 'vitest';
import { createLocalPrerenderArtifacts } from '../../../tools/experience-runner/prerender-artifacts';
import { RunnerCapacityError } from '../../../tools/experience-runner/runner-transport';
import type { BuildSupervisorTestFixture } from './local-build-supervisor.test';

export function registerBuildCapacityCase(fixture: BuildSupervisorTestFixture) {
  const { f, context, deps, validCandidate, runExperienceBuild } = fixture;
  it('rejects a production build before claiming a job without a connection identity', async () => {
    const execute = vi.fn(async () => ({ output: validCandidate() }));
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    await expect(
      runExperienceBuild(
        { merchantId: 'merchant', supabase: { rpc } } as never,
        { jobId: 'j', idempotencyKey: 'i' },
        {
          ...deps(execute),
          profile: 'production',
          hostOrigin: 'https://shop.synthetic.test',
          prerenderArtifacts: createLocalPrerenderArtifacts(),
          bootstrap: async () => deps(execute).bootstrap,
        }
      )
    ).rejects.toThrow('BUILD_CONNECTION_REQUIRED');
    expect(rpc).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['verifier', Error('VERIFIER_BUSY')],
    ['runner', new RunnerCapacityError()],
  ])('leaves a linked attempt recoverable when %s capacity stays busy', async (stage, error) => {
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
    if (stage === 'runner') execute.mockRejectedValueOnce(error);
    else input.recordVerifiedEvidence.mockRejectedValueOnce(error);
    await expect(
      runExperienceBuild(
        linked as never,
        { jobId: 'j', idempotencyKey: 'i' },
        input
      )
    ).rejects.toBe(error);
    const calls = rpc.mock.calls.map(([name]) => name);
    expect(calls).toContain('experience_claim_build');
    if (stage === 'verifier')
      expect(calls).toContain('experience_renew_build_lease');
    expect(calls).not.toContain('experience_fail_build');
    expect(f.finalize).not.toHaveBeenCalled();
  });
}

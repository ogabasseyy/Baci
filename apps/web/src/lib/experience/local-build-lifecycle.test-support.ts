import { sourceDigest } from '@baci/shared/experience';
import { expect, it, vi } from 'vitest';

import { createLocalPrerenderArtifacts } from '../../../tools/experience-runner/prerender-artifacts';
import type { BuildSupervisorTestFixture } from './local-build-supervisor.test';

export function registerBuildLifecycleCases(
  fixture: BuildSupervisorTestFixture
) {
  const { f, context, deps, hostOrigin, validCandidate, runExperienceBuild } =
    fixture;
  it('aborts a disconnected synchronous build and stops renewing its lease', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { promise: entered, resolve: enter } = Promise.withResolvers<void>();
    const { promise: output, resolve: finish } =
      Promise.withResolvers<unknown>();
    const run = vi.fn(() => {
      enter();
      return output;
    });
    const withSignal = vi.fn(
      (_kind: string, _payload: unknown, signal: AbortSignal) => {
        signal.addEventListener(
          'abort',
          () => finish({ output: validCandidate() }),
          { once: true }
        );
        return run();
      }
    );
    const original = context as unknown as {
      supabase: object;
      merchantId: string;
    };
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const linked = {
      ...original,
      signal: controller.signal,
      identity: { connectionId: 'connection', grantVersion: 1 },
      supabase: { ...original.supabase, rpc },
    };
    const input = deps(Object.assign(run, { withSignal }));
    const build = runExperienceBuild(
      linked as never,
      { jobId: 'j', idempotencyKey: 'i' },
      input
    );
    const failed = expect(build).rejects.toThrow();
    try {
      await entered;
      await vi.advanceTimersByTimeAsync(120000);
      controller.abort();
      await failed;
      await vi.advanceTimersByTimeAsync(120000);
      expect(withSignal).toHaveBeenCalledOnce();
      expect(withSignal.mock.calls[0]?.[2]).toBe(controller.signal);
      expect(rpc.mock.calls.flat()).toEqual([
        'experience_claim_build',
        expect.any(Object),
        'experience_renew_build_lease',
        expect.any(Object),
        'experience_fail_build',
        expect.any(Object),
      ]);
      expect(input.recordVerifiedEvidence).not.toHaveBeenCalled();
      expect(f.finalize).not.toHaveBeenCalled();
    } finally {
      controller.abort();
      finish({ output: validCandidate() });
      vi.useRealTimers();
    }
  });

  it('does not record evidence or finalize when the linked build lease is lost', async () => {
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
      supabase: { rpc: (name: string) => Promise<unknown> };
    };
    const linked = {
      ...original,
      identity: { connectionId: 'connection', grantVersion: 1 },
      supabase: {
        ...original.supabase,
        rpc: vi.fn(async (name: string) =>
          name === 'experience_renew_build_lease'
            ? { data: false, error: null }
            : { data: null, error: null }
        ),
      },
    };
    const input = deps(execute);
    await expect(
      runExperienceBuild(
        linked as never,
        { jobId: 'j', idempotencyKey: 'i' },
        input
      )
    ).rejects.toThrow('BUILD_LEASE_LOST');
    expect(input.recordVerifiedEvidence).not.toHaveBeenCalled();
    expect(f.finalize).not.toHaveBeenCalled();
  });
  it('recovers a missing renderer after finalization without creating a second build or repeating capture', async () => {
    const candidate = validCandidate();
    const execute = vi.fn(async (kind: string) => ({
      jobId: `${kind}-synthetic`,
      output:
        kind === 'prerender-build'
          ? { client: candidate, renderer: candidate }
          : kind === 'prerender'
            ? { format: 'baci-prerender/v1', html: '<h1>Synthetic</h1>' }
            : {
                status: 'passed',
                buildDigest: candidate.digest,
                screenshot: Buffer.from('89504e470d0a1a0a', 'hex').toString(
                  'base64'
                ),
              },
    }));
    const storage = createLocalPrerenderArtifacts();
    const retain = vi.fn(storage.retain).mockImplementationOnce(() => {
      throw Error('SYNTHETIC_DISK_FAILURE');
    });
    const input = {
      ...deps(execute),
      prerenderArtifacts: { read: storage.read, retain },
    };
    const remove = vi.spyOn(input.transient, 'remove');
    f.finalize.mockImplementationOnce(() => {
      f.job.status = 'finalized';
      f.existingBuild = {
        id: 'build',
        build_digest: candidate.digest,
        host_origin: hostOrigin,
      };
      return Promise.resolve({
        buildId: 'build',
        buildDigest: candidate.digest,
      });
    });
    await expect(
      runExperienceBuild(context, { jobId: 'j', idempotencyKey: 'i' }, input)
    ).rejects.toThrow('SYNTHETIC_DISK_FAILURE');
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('transient');
    const captures = execute.mock.calls.filter(
      ([kind]) => kind === 'capture'
    ).length;
    expect(captures).toBe(6);
    expect(f.job.status).toBe('finalized');
    await expect(
      runExperienceBuild(context, { jobId: 'j', idempotencyKey: 'i' }, input)
    ).resolves.toMatchObject({
      buildId: 'build',
      buildDigest: candidate.digest,
    });
    expect(f.finalize).toHaveBeenCalledOnce();
    expect(
      execute.mock.calls.filter(([kind]) => kind === 'capture')
    ).toHaveLength(captures);
    expect(
      storage.read({
        merchantId: 'merchant',
        buildId: 'build',
        buildDigest: candidate.digest,
        sourceDigest: f.job.source_digest,
      }).digest
    ).toBe(candidate.digest);
  });

  it('rejects a nonlocal build parent before owner access, execution or evidence writes', async () => {
    const execute = vi.fn();
    const recordVerifiedEvidence = vi.fn();
    await expect(
      runExperienceBuild({} as never, { jobId: 'j', idempotencyKey: 'i' }, {
        hostOrigin: 'https://external.invalid',
        execute,
        recordVerifiedEvidence,
      } as never)
    ).rejects.toThrow('Invalid local preview host');
    expect(execute).not.toHaveBeenCalled();
    expect(recordVerifiedEvidence).not.toHaveBeenCalled();
  });

  it('rejects oversized compiled JavaScript before output acceptance, capture, or finalization', async () => {
    const candidate = validCandidate('x'.repeat(256 * 1024 + 1));
    const execute = vi.fn(async (kind: string) => ({
      jobId: kind === 'compile' ? 'compile' : 'unexpected',
      output: kind === 'compile' ? candidate : {},
    }));
    const inputDeps = deps(execute);
    await expect(
      runExperienceBuild(
        context,
        { jobId: 'j', idempotencyKey: 'i' },
        inputDeps
      )
    ).rejects.toMatchObject({
      code: 'PERFORMANCE_BUDGET_EXCEEDED',
      resource: 'javascript',
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(f.accept).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalledWith('capture', expect.anything());
    expect(f.finalize).not.toHaveBeenCalled();
    expect(f.fail).toHaveBeenCalledOnce();
  });

  it('measures decoded design asset bytes before accepting the candidate', async () => {
    const candidate = validCandidate();
    f.manifest.assets = [{ assetId: 'design-image', alt: 'Design image' }];
    f.assets = [
      {
        mime: 'image/png',
        bytesBase64: Buffer.alloc(256 * 1024 + 1, 1).toString('base64'),
      },
    ];
    f.job.source_digest = sourceDigest(f.manifest);
    const execute = vi.fn(async () => ({
      jobId: 'compile',
      output: candidate,
    }));
    await expect(
      runExperienceBuild(
        context,
        { jobId: 'j', idempotencyKey: 'i' },
        deps(execute)
      )
    ).rejects.toMatchObject({
      code: 'PERFORMANCE_BUDGET_EXCEEDED',
      resource: 'png-asset',
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(f.accept).not.toHaveBeenCalled();
    expect(f.finalize).not.toHaveBeenCalled();
  });

  it('accepts a small compiled candidate and reaches independent capture and finalization', async () => {
    const candidate = validCandidate();
    const execute = vi.fn(async (kind: string) => ({
      jobId: `${kind}-job`,
      output:
        kind === 'capture'
          ? {
              status: 'passed',
              buildDigest: candidate.digest,
              screenshot: Buffer.from('89504e470d0a1a0a', 'hex').toString(
                'base64'
              ),
            }
          : candidate,
    }));
    const inputDeps = deps(execute);
    inputDeps.transient.read = vi.fn(() => candidate);
    f.finalize.mockResolvedValueOnce({
      buildId: 'build',
      buildDigest: candidate.digest,
    });
    const result = await runExperienceBuild(
      context,
      { jobId: 'j', idempotencyKey: 'i' },
      inputDeps
    );
    expect(
      execute.mock.calls.filter(([kind]) => kind === 'capture')
    ).toHaveLength(6);
    expect(f.accept).toHaveBeenCalledOnce();
    expect(f.finalize).toHaveBeenCalledOnce();
    expect(result.buildDigest).toBe(candidate.digest);
  });
}

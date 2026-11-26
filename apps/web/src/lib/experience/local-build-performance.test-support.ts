import { type ExperienceManifest, sourceDigest } from '@baci/shared/experience';
import { expect, it, vi } from 'vitest';
import { measureCandidatePerformance } from './candidate-performance-measurement';
import type { BuildSupervisorTestFixture } from './local-build-supervisor.test';
import { selectInitialExperienceView } from './local-prerender-pipeline';
import { loadOwnerPreviewBootstrap } from './owner-preview-bootstrap';

export function registerBuildPerformanceCases(
  fixture: BuildSupervisorTestFixture
) {
  const { f, context, deps, validCandidate, runExperienceBuild } = fixture;
  it('finishes a build for a new empty store while reporting performance as not measured', async () => {
    const manifest = f.manifest as ExperienceManifest;
    const oldRoutes = manifest.routes;
    manifest.routes = [
      { path: '/products/[handle]', view: 'product' },
      { path: '/', view: 'home' },
    ];
    f.job.source_digest = sourceDigest(manifest);
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
    const input = {
      ...deps(execute),
      bootstrap: (ctx: typeof context, source: ExperienceManifest) =>
        loadOwnerPreviewBootstrap(
          ctx,
          source,
          selectInitialExperienceView(source.routes)
        ),
      performanceMeasurement: (
        measurement: Parameters<typeof measureCandidatePerformance>[0]
      ) =>
        measureCandidatePerformance({
          ...measurement,
          execute: execute as never,
          bootstrap: (view) =>
            loadOwnerPreviewBootstrap(context, manifest, view),
          hostContaminated: () => false,
        }),
    };
    try {
      const result = await runExperienceBuild(
        context,
        { jobId: 'j', idempotencyKey: 'i' },
        input as never
      );
      expect(f.finalize).toHaveBeenCalledOnce();
      expect(result.performance).toMatchObject({
        status: 'not-measured',
        cwvQualified: false,
        releaseQualified: false,
      });
      expect(execute.mock.calls.some(([kind]) => kind === 'performance')).toBe(
        false
      );
    } finally {
      manifest.routes = oldRoutes;
    }
  });

  it('records measured qualification evidence before accepting and retains it after finalization', async () => {
    const candidate = validCandidate();
    const order: string[] = [];
    const report = {
      format: 'baci.performance-lab/v1',
      buildDigest: candidate.digest,
      sourceDigest: f.job.source_digest,
      measuredAt: new Date().toISOString(),
      renderer: 'client',
      environment: 'local-synthetic',
      cwvQualified: false,
      releaseQualified: false,
      contaminated: false,
      browser: 'Chromium 140',
      samples: [],
    };
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
    const inputDeps = {
      ...deps(execute),
      performanceMeasurement: vi.fn(() => {
        order.push('measure');
        return Promise.resolve({ status: 'measured' as const, report });
      }),
      performanceReports: {
        retain: vi.fn(() => order.push('retain')),
      },
    };
    inputDeps.transient.read = vi.fn(() => candidate);
    f.accept.mockImplementationOnce(() => {
      order.push('accept');
      return Promise.resolve('transient');
    });
    f.finalize.mockImplementationOnce(() => {
      order.push('finalize');
      return Promise.resolve({
        buildId: 'build',
        buildDigest: candidate.digest,
      });
    });

    const result = await runExperienceBuild(
      context,
      { jobId: 'j', idempotencyKey: 'i' },
      inputDeps as never
    );

    expect(order.indexOf('measure')).toBeLessThan(order.indexOf('accept'));
    expect(order.indexOf('finalize')).toBeLessThan(order.indexOf('retain'));
    expect(inputDeps.performanceReports.retain).toHaveBeenCalledWith(
      {
        merchantId: 'merchant',
        buildId: 'build',
        buildDigest: candidate.digest,
        sourceDigest: f.job.source_digest,
      },
      report
    );
    expect(result.performance).toEqual({
      status: 'measured',
      cwvQualified: false,
      releaseQualified: false,
    });
  });

  it('keeps functional finalization when report retention fails but does not claim retained measurement', async () => {
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
    const inputDeps = {
      ...deps(execute),
      performanceMeasurement: vi.fn(async () => ({
        status: 'measured' as const,
        jobIds: ['performance-job'],
        report: {
          format: 'baci.performance-lab/v1',
          buildDigest: candidate.digest,
          sourceDigest: f.job.source_digest,
          measuredAt: new Date().toISOString(),
          renderer: 'client',
          environment: 'local-synthetic',
          cwvQualified: false,
          releaseQualified: false,
          contaminated: false,
          browser: 'Chromium 140',
          samples: [],
        },
      })),
      performanceReports: {
        retain: vi.fn(() => {
          throw Error('storage down');
        }),
      },
    };
    inputDeps.transient.read = vi.fn(() => candidate);
    const result = await runExperienceBuild(
      context,
      { jobId: 'j', idempotencyKey: 'i' },
      inputDeps as never
    );
    expect(f.finalize).toHaveBeenCalledOnce();
    expect(result.performance).toEqual({
      status: 'not-measured',
      cwvQualified: false,
      releaseQualified: false,
    });
  });

  it('rejects oversized prerender HTML before output acceptance or browser capture', async () => {
    const candidate = validCandidate();
    const execute = vi.fn(async (kind: string) => ({
      jobId: `${kind}-job`,
      output:
        kind === 'prerender-build'
          ? { client: candidate, renderer: candidate }
          : kind === 'prerender'
            ? {
                format: 'baci-prerender/v1',
                html: 'x'.repeat(128 * 1024 + 1),
              }
            : {},
    }));
    const inputDeps = {
      ...deps(execute),
      prerenderArtifacts: {
        retain: vi.fn(),
        read: vi.fn(() => candidate),
      },
    };
    await expect(
      runExperienceBuild(
        context,
        { jobId: 'j', idempotencyKey: 'i' },
        inputDeps
      )
    ).rejects.toMatchObject({
      code: 'PERFORMANCE_BUDGET_EXCEEDED',
      resource: 'ssr-html',
    });
    expect(execute.mock.calls.map(([kind]) => kind)).toEqual([
      'prerender-build',
      'prerender-build',
      'prerender',
    ]);
    expect(f.accept).not.toHaveBeenCalled();
    expect(f.finalize).not.toHaveBeenCalled();
  });
}

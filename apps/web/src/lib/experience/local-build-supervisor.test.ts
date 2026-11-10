import { type ExperienceManifest, sourceDigest } from '@baci/shared/experience';
import { beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  accept: vi.fn(async () => 'transient'),
  finalize: vi.fn(async () => ({ buildId: 'build', buildDigest: 'digest' })),
  fail: vi.fn(async () => ({ data: null, error: null })),
  existingBuild: null as {
    id: string;
    build_digest: string;
    host_origin: string;
  } | null,
  assets: [] as Array<{
    mime: 'image/png' | 'font/woff2';
    bytesBase64: string;
  }>,
  job: {
    id: 'j',
    status: 'queued',
    expires_at: new Date(Date.now() + 600000).toISOString(),
    artifact_id: 'artifact',
    source_digest: '',
    attempt_nonce: 'attempt',
  },
  manifest: {
    format: 'baci.experience/v2' as const,
    runtime: 'react-browser-sandbox/v1' as const,
    sdkVersion: 'commerce-bridge/v1' as const,
    entry: 'Experience.tsx',
    files: [{ path: 'Experience.tsx', content: 'export default () => null' }],
    packages: [],
    routes: [{ path: '/', view: 'home' as const }],
    assets: [] as Array<{ assetId: string; alt: string }>,
    capabilities: [] as ExperienceManifest['capabilities'],
  },
}));

vi.mock('./authorization', () => ({
  requireExperienceOwner: vi.fn(async (ctx) => ctx),
  ownerRpcArgs: vi.fn(() => ({})),
}));
vi.mock('./repository', () => ({
  createExperienceRepository: vi.fn(() => ({
    loadOwnedJob: vi.fn(async () => f.job),
  })),
}));
vi.mock('./asset-service', () => ({
  loadOfflineAssets: vi.fn(async () => f.assets),
}));
vi.mock('../../../tools/experience-runner/output-receiver', () => ({
  acceptJobOutput: f.accept,
  signJobTicket: vi.fn(() => 'ticket'),
}));
vi.mock('../../../tools/experience-runner/private-build-payload', () => ({
  packPrivateBuild: vi.fn((manifest) => manifest),
}));
vi.mock('./finalize-build', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...(original as Record<string, unknown>),
    finalizeExperienceBuild: f.finalize,
  };
});

import { createLocalPrerenderArtifacts } from '../../../tools/experience-runner/prerender-artifacts';
import { createTransientOutputStore } from '../../../tools/experience-runner/transient-output-store';
import { runExperienceBuild } from './local-build-supervisor';
import { digestBytes } from './manifest-digest';

const hostOrigin = 'http://127.0.0.1:4100';
const validCandidate = (javascript = 'export default 1;', css = '') => ({
  javascript,
  css,
  hostOrigin,
  imports: [],
  digest: digestBytes(`${javascript}\0${css}`),
});
const deps = (execute: (kind: string, input: unknown) => Promise<unknown>) => ({
  key: new Uint8Array(32),
  toolchainDigest: 'toolchain',
  hostOrigin,
  transient: Object.assign(createTransientOutputStore(), {
    read: vi.fn(() => validCandidate()),
  }),
  recordVerifiedEvidence: vi.fn(async () => {}),
  bootstrap: {
    catalog: { products: [], revision: 'r' },
    capabilities: [],
    route: {
      epoch: 1,
      routeId: 'home',
      canonicalPath: '/',
      params: {},
      publicDataRevision: 'r',
    },
  },
  execute: execute as never,
});
const context = {
  merchantId: 'merchant',
  supabase: {
    rpc: vi.fn(async (name: string) =>
      name === 'experience_fail_build' ? f.fail() : { data: null, error: null }
    ),
    from: vi.fn((table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data:
            table === 'experience_builds'
              ? f.existingBuild
              : { manifest: f.manifest },
          error: null,
        }),
      };
      return query;
    }),
  },
} as never;

beforeEach(() => {
  f.accept.mockClear();
  f.finalize.mockClear();
  f.fail.mockClear();
  f.assets = [];
  f.manifest.assets = [];
  f.job.source_digest = sourceDigest(f.manifest);
  f.job.status = 'queued';
  f.existingBuild = null;
  f.job.expires_at = new Date(Date.now() + 600000).toISOString();
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
  f.finalize.mockImplementationOnce(async () => {
    f.job.status = 'finalized';
    f.existingBuild = {
      id: 'build',
      build_digest: candidate.digest,
      host_origin: hostOrigin,
    };
    return { buildId: 'build', buildDigest: candidate.digest };
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
  ).resolves.toMatchObject({ buildId: 'build', buildDigest: candidate.digest });
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
    runExperienceBuild(context, { jobId: 'j', idempotencyKey: 'i' }, inputDeps)
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
  const execute = vi.fn(async () => ({ jobId: 'compile', output: candidate }));
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
    performanceMeasurement: vi.fn(async () => {
      order.push('measure');
      return { status: 'measured' as const, report };
    }),
    performanceReports: {
      retain: vi.fn(() => order.push('retain')),
    },
  };
  inputDeps.transient.read = vi.fn(() => candidate);
  f.accept.mockImplementationOnce(async () => {
    order.push('accept');
    return 'transient';
  });
  f.finalize.mockImplementationOnce(async () => {
    order.push('finalize');
    return { buildId: 'build', buildDigest: candidate.digest };
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
    runExperienceBuild(context, { jobId: 'j', idempotencyKey: 'i' }, inputDeps)
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

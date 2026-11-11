// @vitest-environment node
import { sourceDigest } from '@baci/shared/experience';
import { expect, it, vi } from 'vitest';
import { parseExperienceManifest } from '@/schemas/experience-manifest';
import type { ExperienceContext } from './authorization';
import { digestBytes } from './manifest-digest';
import { recoverFinalizedBuild } from './recover-finalized-build';

const hostOrigin = 'http://127.0.0.1:4100';
const candidate = (javascript = 'export{}') => ({
  javascript,
  css: '',
  imports: [],
  hostOrigin,
  digest: digestBytes(`${javascript}\0`),
});
function fixture() {
  const manifest = parseExperienceManifest({
    format: 'baci.experience/v2',
    runtime: 'react-browser-sandbox/v1',
    sdkVersion: 'commerce-bridge/v1',
    entry: 'app.tsx',
    files: [{ path: 'app.tsx', content: 'export default()=>null' }],
    packages: [],
    assets: [],
    routes: [{ path: '/', view: 'home' }],
    capabilities: [],
  });
  const job = {
    id: 'job',
    artifact_id: 'source',
    attempt_nonce: 'attempt',
    source_digest: sourceDigest(manifest),
    status: 'finalized',
    expires_at: '2099-01-01T00:00:00.000Z',
  };
  const rpc = vi.fn(async (_name: string) => ({ data: true, error: null }));
  const ctx: ExperienceContext = {
    merchantId: 'merchant',
    actorUserId: 'owner',
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }),
      },
      rpc,
      from: (table: string) => {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({
            error: null,
            data:
              table === 'experience_builds'
                ? {
                    id: 'build',
                    build_digest: candidate().digest,
                    host_origin: hostOrigin,
                  }
                : table === 'experience_jobs'
                  ? job
                  : { manifest },
          }),
        };
        return query;
      },
    } as never,
  };
  const execute = vi.fn(async () => ({
    jobId: 'synthetic',
    wallMs: 1,
    output: { client: candidate(), renderer: candidate() },
  }));
  const read = vi.fn(() => {
    throw Error('OUTPUT_NOT_RETAINED');
  });
  const retain = vi.fn();
  const deps = { hostOrigin, execute, artifacts: { read, retain } };
  return { ctx, job, rpc, execute, read, retain, deps };
}
it('repairs only an exact finalized source/client binding, without database writes', async () => {
  const f = fixture();
  expect(await recoverFinalizedBuild(f.ctx, f.job, f.deps)).toMatchObject({
    buildId: 'build',
    buildDigest: candidate().digest,
  });
  expect(f.execute).toHaveBeenCalledTimes(2);
  expect(f.retain).toHaveBeenCalledWith(
    expect.objectContaining({
      merchantId: 'merchant',
      buildId: 'build',
      sourceDigest: f.job.source_digest,
    })
  );
  expect(
    f.rpc.mock.calls.every(([name]) => name === 'experience_require_owner')
  ).toBe(true);
});
it('rejects a source or independent compilation mismatch without retaining output', async () => {
  const f = fixture();
  f.job.source_digest = '0'.repeat(64);
  await expect(recoverFinalizedBuild(f.ctx, f.job, f.deps)).rejects.toThrow(
    'BUILD_FAILED'
  );
  expect(f.execute).not.toHaveBeenCalled();
  const g = fixture();
  g.execute.mockResolvedValueOnce({
    jobId: 'bad',
    wallMs: 1,
    output: {
      client: candidate('export const changed=1'),
      renderer: candidate(),
    },
  });
  await expect(recoverFinalizedBuild(g.ctx, g.job, g.deps)).rejects.toThrow(
    'BUILD_FAILED'
  );
  expect(g.retain).not.toHaveBeenCalled();
});
it('does not overwrite corrupted companions or execute expired recovery jobs', async () => {
  const f = fixture();
  f.read.mockImplementationOnce(() => {
    throw Error('BUILD_FAILED');
  });
  await expect(recoverFinalizedBuild(f.ctx, f.job, f.deps)).rejects.toThrow(
    'BUILD_FAILED'
  );
  expect(f.execute).not.toHaveBeenCalled();
  const g = fixture();
  g.job.expires_at = '2000-01-01T00:00:00.000Z';
  await expect(recoverFinalizedBuild(g.ctx, g.job, g.deps)).rejects.toThrow(
    'BUILD_FAILED'
  );
  expect(g.execute).not.toHaveBeenCalled();
  expect(g.retain).not.toHaveBeenCalled();
});

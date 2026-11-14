import { expect, it, vi } from 'vitest';
import { digestBytes } from './manifest-digest';
import { createPrivateExperienceCapture } from './private-capture-service';

const merchantId = '11111111-1111-4111-8111-111111111111';
const buildId = '22222222-2222-4222-8222-222222222222';
const idempotencyKey = '33333333-3333-4333-8333-333333333333';
const input = { buildId, routeId: '/', idempotencyKey };
function fixture() {
  const javascript = 'export default null;';
  const css = '';
  const buildDigest = digestBytes(`${javascript}\0${css}`);
  const manifest = {
    format: 'baci.experience/v2',
    runtime: 'react-browser-sandbox/v1',
    sdkVersion: 'commerce-bridge/v1',
    entry: 'app.tsx',
    files: [{ path: 'app.tsx', content: javascript }],
    packages: [],
    routes: [{ path: '/', view: 'home' }],
    assets: [],
    capabilities: ['navigation'],
  };
  const rows: Record<string, unknown> = {
    experience_builds: {
      id: buildId,
      build_digest: buildDigest,
      job_id: 'job',
      host_origin: 'http://localhost:43174',
    },
    experience_jobs: { artifact_id: 'artifact', status: 'finalized' },
    experience_artifacts: { manifest },
    experience_build_files: [javascript, css].map((value, i) => ({
      path: i ? 'app.css' : 'app.js',
      bytes: `\\x${Buffer.from(value).toString('hex')}`,
      digest: digestBytes(value),
    })),
    experience_snapshots: [],
  };
  const eq = vi.fn();
  const from = vi.fn((table: string) => {
    let allowedPaths: string[] | undefined;
    const q = {
      select: () => q,
      eq: (key: string, value: string) => {
        eq(table, key, value);
        return q;
      },
      like: () => q,
      in: (_key: string, values: string[]) => {
        allowedPaths = values;
        return q;
      },
      maybeSingle: async () => ({ data: rows[table], error: null }),
      limit: async (n: number) => ({
        data: Array.isArray(rows[table])
          ? (rows[table] as { path?: string }[])
              .filter(
                (row) => !allowedPaths || allowedPaths.includes(row.path ?? '')
              )
              .slice(0, n)
          : rows[table],
        error: null,
      }),
    };
    return q;
  });
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  const getUser = vi.fn(async () => ({
    data: { user: { id: merchantId } },
    error: null,
  }));
  const ctx = { merchantId, supabase: { from, rpc, auth: { getUser } } };
  const record = vi.fn(
    async (capture: {
      id: string;
      buildId: string;
      buildDigest: string;
      keyDigest: string;
      snapshot: { key: unknown };
    }) => {
      rows.experience_snapshots = [
        {
          id: capture.id,
          build_id: capture.buildId,
          build_digest: capture.buildDigest,
          key_digest: capture.keyDigest,
          snapshot_key: capture.snapshot.key,
        },
      ];
    }
  );
  const capture = vi.fn(async () => ({
    snapshot: {
      key: {
        build: buildDigest,
        assets: digestBytes(JSON.stringify([])),
        catalog: 'revision',
        path: '/',
        viewport: '390',
        locale: 'en-NG',
        browser: 'chromium',
        extractor: 'semantic-v1',
      },
      text: 'synthetic',
    },
    evidence: { bytes: Buffer.from('synthetic-image') },
  }));
  const bootstrap = vi.fn(async () => ({
    catalog: { revision: 'revision' },
    route: { canonicalPath: '/' },
  }));
  const run = createPrivateExperienceCapture({
    hostOrigin: 'http://localhost:43174',
    record,
    capture: capture as never,
    bootstrap: bootstrap as never,
  });
  return {
    ctx,
    run,
    rows,
    eq,
    from,
    rpc,
    getUser,
    capture,
    record,
    bootstrap,
    buildDigest,
  };
}

it('selects the executable files even when another retained file appears first', async () => {
  const f = fixture();
  (f.rows.experience_build_files as unknown[]).unshift({ path: 'extra.txt' });
  await f.run(f.ctx as never, input);
  expect(f.capture).toHaveBeenCalledOnce();
});

it('captures merchant/build-bound evidence through the normal owner client and replays idempotently', async () => {
  const f = fixture();
  const first = await f.run(f.ctx as never, input);
  expect(await f.run(f.ctx as never, input)).toEqual(first);
  expect(f.capture).toHaveBeenCalledOnce();
  expect(f.record).toHaveBeenCalledOnce();
  expect(f.record).toHaveBeenCalledWith(
    expect.objectContaining({
      merchantId,
      buildId,
      buildDigest: f.buildDigest,
      evidenceDigest: digestBytes(Buffer.from('synthetic-image')),
    })
  );
  for (const table of Object.keys(f.rows))
    expect(f.eq).toHaveBeenCalledWith(table, 'merchant_id', merchantId);
  expect(f.eq).toHaveBeenCalledWith('experience_builds', 'id', buildId);
  expect(f.getUser).toHaveBeenCalledTimes(4);
  expect(first.previewUrl).toContain(`merchant=${merchantId}&build=${buildId}`);
});
it('does not reuse evidence after its catalog changes, even before restart', async () => {
  const f = fixture();
  await f.run(f.ctx as never, input);
  f.bootstrap.mockResolvedValueOnce({
    catalog: { revision: 'changed' },
    route: { canonicalPath: '/' },
  });
  await expect(f.run(f.ctx as never, input)).rejects.toThrow(
    'IDEMPOTENCY_CONFLICT'
  );
  expect(f.capture).toHaveBeenCalledOnce();
});

it('rejects owner authorization before reads, including cached replay', async () => {
  const f = fixture();
  f.rpc.mockResolvedValueOnce({ data: false, error: null });
  await expect(f.run(f.ctx as never, input)).rejects.toThrow('NOT_FOUND');
  expect(f.from).not.toHaveBeenCalled();
  expect(f.capture).not.toHaveBeenCalled();
  await f.run(f.ctx as never, input);
  f.rpc.mockResolvedValueOnce({ data: false, error: null });
  await expect(f.run(f.ctx as never, input)).rejects.toThrow('NOT_FOUND');
  expect(f.record).toHaveBeenCalledOnce();
});

it('rejects an idempotency-key conflict before another capture', async () => {
  const f = fixture();
  await f.run(f.ctx as never, input);
  await expect(
    f.run(f.ctx as never, { ...input, routeId: '/products/device' })
  ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  expect(f.capture).toHaveBeenCalledOnce();
});

it.each([
  'experience_builds',
  'experience_artifacts',
])('rejects an unavailable bound %s', async (table) => {
  const f = fixture();
  f.rows[table] = null;
  await expect(f.run(f.ctx as never, input)).rejects.toThrow('NOT_FOUND');
  expect(f.capture).not.toHaveBeenCalled();
  expect(f.record).not.toHaveBeenCalled();
});

it('rejects a mismatched build origin or unfinalized job', async () => {
  const f = fixture();
  f.rows.experience_builds = { host_origin: 'http://localhost:9999' };
  await expect(f.run(f.ctx as never, input)).rejects.toThrow('NOT_FOUND');
  const g = fixture();
  g.rows.experience_jobs = { status: 'running' };
  await expect(g.run(g.ctx as never, input)).rejects.toThrow('BUILD_FAILED');
  expect(g.capture).not.toHaveBeenCalled();
});

it.each([
  'capture',
  'record',
] as const)('clears a failed %s attempt so it can be retried', async (stage) => {
  const f = fixture();
  f[stage].mockRejectedValueOnce(Error('synthetic failure'));
  await expect(f.run(f.ctx as never, input)).rejects.toThrow(
    'synthetic failure'
  );
  await expect(f.run(f.ctx as never, input)).resolves.toMatchObject({
    buildId,
  });
  expect(f.capture).toHaveBeenCalledTimes(2);
  expect(f.record).toHaveBeenCalledTimes(stage === 'capture' ? 1 : 2);
});

it('does not persist evidence when owner authorization is revoked during capture', async () => {
  const f = fixture();
  f.capture.mockImplementationOnce(async () => {
    f.rpc.mockResolvedValueOnce({ data: false, error: null });
    return {
      snapshot: {
        key: {
          build: f.buildDigest,
          assets: 'a'.repeat(64),
          catalog: 'revision',
          path: '/',
          viewport: '390',
          locale: 'en-NG',
          browser: 'chromium',
          extractor: 'semantic-v1',
        },
        text: 'synthetic',
      },
      evidence: { bytes: Buffer.from('synthetic-image') },
    };
  });
  await expect(f.run(f.ctx as never, input)).rejects.toThrow('NOT_FOUND');
  expect(f.record).not.toHaveBeenCalled();
});

it('returns the requested non-default route in the owner preview URL', async () => {
  const f = fixture();
  const artifact = f.rows.experience_artifacts as {
    manifest: Record<string, unknown>;
  };
  artifact.manifest = {
    ...artifact.manifest,
    routes: [
      { path: '/', view: 'home' },
      { path: '/collections/all', view: 'collection' },
    ],
  };
  const result = await f.run(f.ctx as never, {
    ...input,
    routeId: '/collections/all',
  });
  expect(new URL(result.previewUrl).searchParams.get('routeId')).toBe(
    '/collections/all'
  );
  expect(f.bootstrap).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    '/collections/all'
  );
});

import { expect, it } from 'vitest';
import { digestBytes } from './manifest-digest';
import {
  buildId,
  fixture,
  input,
  merchantId,
} from './private-capture-service.test-support';

it('selects the executable files even when another retained file appears first', async () => {
  const f = fixture();
  (f.rows.experience_build_files as unknown[]).unshift({ path: 'extra.txt' });
  await f.run(f.ctx as never, input);
  expect(f.capture).toHaveBeenCalledOnce();
});

it('replays a capture when the database returns its assets in a different order', async () => {
  const f = fixture();
  const artifact = f.rows.experience_artifacts as {
    manifest: { assets: unknown[] };
  };
  const assets = ['front', 'side'].map((asset_id, index) => {
    const bytes = Buffer.alloc(48);
    bytes.write('wOF2');
    bytes.writeUInt32BE(bytes.length, 8);
    bytes[47] = index;
    return {
      asset_id,
      digest: digestBytes(bytes),
      mime: 'font/woff2',
      bytes: `\\x${bytes.toString('hex')}`,
      purpose: 'design',
    };
  });
  artifact.manifest.assets = assets.map(({ asset_id }) => ({
    assetId: asset_id,
    alt: '',
  }));
  f.rows.experience_assets = assets;
  const first = await f.run(f.ctx as never, input);
  assets.reverse();
  expect(await f.run(f.ctx as never, input)).toEqual(first);
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

it('reuses internal approval evidence only for the exact current snapshot', async () => {
  const f = fixture();
  const attest = () => f.run(f.ctx as never, input, 'approval');

  const first = await attest();
  expect(await attest()).toEqual(first);
  f.bootstrap.mockResolvedValue({
    catalog: { revision: 'changed' },
    route: { canonicalPath: '/' },
  });
  const second = await attest();
  expect(second.evidenceId).not.toBe(first.evidenceId);
  expect(await attest()).toEqual(second);
  expect(f.capture).toHaveBeenCalledTimes(2);
  expect(f.record).toHaveBeenCalledTimes(2);
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
  const result = await f.capture.getMockImplementation()?.({
    assetsDigest: 'a'.repeat(64),
  });
  f.capture.mockImplementationOnce(async () => {
    f.rpc.mockResolvedValueOnce({ data: false, error: null });
    if (!result) throw Error('Missing synthetic capture');
    return result;
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

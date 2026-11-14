import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { bindPublicHead } from './public-head-binding';

const hash = (value: Buffer | string) =>
  createHash('sha256').update(value).digest('hex');
const js = Buffer.from('script');
const css = Buffer.from('style');
const build = hash(Buffer.concat([js, Buffer.from([0]), css]));
const id = '10000000-0000-4000-8000-000000000001';
const receipt = {
  approvalId: id,
  merchantId: id,
  buildId: id,
  receiptId: id,
  effectDigest: 'c'.repeat(64),
  publishedVersion: 2,
  status: 'verifying',
  action: 'publish',
};
const head = {
  merchantId: id,
  buildDigest: build,
  version: 2,
  policyRevision: '2',
  assetsDigest: 'd'.repeat(64),
  routes: [{ path: '/', view: 'home' }],
  assets: [],
  capabilities: [],
};
const file = (path: string, bytes: Buffer, mime: string) => ({
  path,
  bytes,
  mime,
  digest: hash(bytes),
});
function fixture() {
  return {
    loadReceipt: vi.fn(async () => receipt),
    loadMerchant: vi.fn(async () => ({ slug: 'synthetic' })),
    loadBuildDigest: vi.fn(async () => build),
    canonicalBase: vi.fn(async () => 'https://synthetic.example.com'),
    manifest: vi.fn(async () => head),
    read: vi.fn(async (_slug: string, _build: string, path: string) =>
      path === 'app.js'
        ? file(path, js, 'text/javascript')
        : file(path, css, 'text/css')
    ),
  };
}
it('binds a verifying receipt to its exact public head, bytes and canonical origin', async () => {
  const result = await bindPublicHead(id, fixture());
  expect(result).toMatchObject({
    merchantId: id,
    buildId: id,
    buildDigest: build,
    publicationRevision: 2,
    scriptDigest: hash(js),
    styleDigest: hash(css),
    canonicalBase: 'https://synthetic.example.com',
  });
});
it('uses the delivered CSS digest after Baci rewrites a known asset URL', async () => {
  const authoredCss = Buffer.from("a{background:url('/assets/logo')}");
  const digest = hash(Buffer.concat([js, Buffer.from([0]), authoredCss]));
  const image = Buffer.from('synthetic image');
  const f = {
    ...fixture(),
    loadBuildDigest: vi.fn(async () => digest),
    manifest: vi.fn(async () => ({
      ...head,
      buildDigest: digest,
      assets: [{ assetId: 'logo', alt: 'Logo' }],
    })),
    read: vi.fn(async (_slug: string, _build: string, path: string) =>
      path === 'app.js'
        ? file(path, js, 'text/javascript')
        : path === 'app.css'
          ? file(path, authoredCss, 'text/css')
          : file(path, image, 'image/png')
    ),
  };
  const result = await bindPublicHead(id, f);
  const servedCss = `a{background:url('/published/synthetic/${digest}/assets/logo')}`;
  expect(result.styleDigest).toBe(hash(servedCss));
  expect(result.assets.logo).toBe(hash(image));
});
it('rejects wrong tenant, revision, changed bytes and a head superseded during reads', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) =>
      f.loadReceipt.mockResolvedValueOnce({ ...receipt, status: 'superseded' }),
    (f: ReturnType<typeof fixture>) =>
      f.manifest.mockResolvedValueOnce({
        ...head,
        merchantId: '20000000-0000-4000-8000-000000000001',
      }),
    (f: ReturnType<typeof fixture>) =>
      f.manifest.mockResolvedValueOnce({ ...head, version: 3 }),
    (f: ReturnType<typeof fixture>) =>
      f.read.mockResolvedValueOnce(
        file('app.js', Buffer.from('changed'), 'text/javascript')
      ),
    (f: ReturnType<typeof fixture>) =>
      f.manifest
        .mockResolvedValueOnce(head)
        .mockResolvedValueOnce({ ...head, version: 3 }),
    (f: ReturnType<typeof fixture>) =>
      f.canonicalBase
        .mockResolvedValueOnce('https://synthetic.example.com')
        .mockResolvedValueOnce('https://other.example.com'),
  ]) {
    const f = fixture();
    mutate(f);
    await expect(bindPublicHead(id, f)).rejects.toThrow();
  }
});

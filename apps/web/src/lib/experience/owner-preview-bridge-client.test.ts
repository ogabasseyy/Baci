// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOwnerPreviewBridge } from './owner-preview-bridge';
import { createOwnerPreviewBridgeClient } from './owner-preview-bridge-client';

const key = new Uint8Array(32).fill(7);
const now = 1700000000000;
const merchantId = '10000000-0000-4000-8000-000000000001';
const buildId = '20000000-0000-4000-8000-000000000001';
const bindingId = '30000000-0000-4000-8000-000000000001';
const token = 'synthetic.user.token';
const launch = {
  src: `https://output.runtime.test/resource/${'a'.repeat(64)}/index.html`,
  bindingId,
  merchantId,
  buildDigest: 'b'.repeat(64),
  instanceId: '40000000-0000-4000-8000-000000000001',
  nonce: '50000000-0000-4000-8000-000000000001',
  expiresAt: now + 300000,
  canonicalBase: 'https://merchant.synthetic.test/shop',
  routes: [{ path: '/', view: 'home' }],
  bootstrap: {
    route: {
      epoch: 1,
      routeId: 'home',
      params: {},
      canonicalPath: '/',
      publicDataRevision: 'r',
    },
    catalog: { products: [], revision: 'r' },
    capabilities: [],
  },
};
function fixture() {
  const owner = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: token } },
        error: null,
      })),
      getUser: vi.fn(async () => ({
        data: { user: { id: 'owner' } },
        error: null,
      })),
    },
    rpc: vi.fn(async () => ({ data: true, error: null })),
  };
  const handler = createOwnerPreviewBridge({
    key,
    now: () => now,
    previewOrigin: 'https://builder.baci.test',
    consumeNonce: vi.fn(async () => true),
    resolveUserClient: vi.fn(async () => owner as never),
    launch: vi.fn(async () => launch),
  });
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(new Request(input, init))
  );
  const client = createOwnerPreviewBridgeClient({
    key,
    executionOrigin: 'https://output.runtime.test',
    now: () => now,
    fetch: fetchImpl,
  });
  return { owner, handler, client, fetchImpl };
}
it('forwards a verified user session over the fixed signed boundary and returns a validated launch', async () => {
  const f = fixture();
  const result = await f.client(f.owner as never, {
    merchantId,
    buildId,
    routeId: 'home',
  });
  expect(result).toMatchObject({ src: launch.src, bindingId, merchantId });
  expect(f.owner.auth.getUser).toHaveBeenCalledWith(token);
  expect(f.fetchImpl).toHaveBeenCalledOnce();
  expect(f.fetchImpl.mock.calls[0][0]).toBe(
    'https://mcp.usebaci.com/internal/owner/preview'
  );
  expect(f.fetchImpl.mock.calls[0][1]).toMatchObject({
    redirect: 'error',
    cache: 'no-store',
    credentials: 'omit',
  });
});
it('does not forward a missing or invalid user session', async () => {
  const f = fixture();
  f.owner.auth.getUser.mockResolvedValue({
    data: { user: null } as never,
    error: null,
  });
  await expect(
    f.client(f.owner as never, { merchantId, buildId })
  ).rejects.toThrow();
  expect(f.fetchImpl).not.toHaveBeenCalled();
});
it('rejects a launch from an unexpected execution origin and oversized responses', async () => {
  const f = fixture();
  f.fetchImpl.mockResolvedValueOnce(
    Response.json({ ...launch, src: 'https://evil.test/resource/file' })
  );
  await expect(
    f.client(f.owner as never, { merchantId, buildId })
  ).rejects.toThrow();
  f.fetchImpl.mockResolvedValueOnce(
    new Response('x'.repeat(300000), {
      headers: { 'content-type': 'application/json' },
    })
  );
  await expect(
    f.client(f.owner as never, { merchantId, buildId })
  ).rejects.toThrow();
});

it('rejects foreign bootstrap assets, expired launches, and wrong merchant bindings', async () => {
  const f = fixture();
  for (const invalid of [
    {
      ...launch,
      bootstrap: {
        ...launch.bootstrap,
        assets: { hero: 'https://evil.test/image' },
      },
    },
    { ...launch, expiresAt: now - 1 },
    { ...launch, merchantId: '60000000-0000-4000-8000-000000000001' },
  ]) {
    f.fetchImpl.mockResolvedValueOnce(Response.json(invalid));
    await expect(
      f.client(f.owner as never, { merchantId, buildId })
    ).rejects.toThrow();
  }
});

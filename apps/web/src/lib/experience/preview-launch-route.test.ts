import { expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  prerender: vi.fn(async () => ({ src: 'synthetic' })),
}));
vi.mock('./authorization', () => ({
  requireExperienceOwner: async (ctx: unknown) => ctx,
  ownerRpcArgs: () => ({}),
}));
vi.mock('./prerender-preview', () => ({
  consumePrerenderPreview: f.prerender,
}));

import { createPreviewLaunch } from './preview-launch';

it.each([
  'product',
  'collection',
  'editorial',
] as const)('defaults a %s-only preview to an authored route', async (view) => {
  const path =
    view === 'product'
      ? '/products/[handle]'
      : view === 'collection'
        ? '/collections/[handle]'
        : '/pages/story';
  const responses = [
    {
      build_digest: 'a'.repeat(64),
      job_id: 'job',
      host_origin: 'https://host.example',
    },
    { artifact_id: 'artifact' },
    {
      manifest: {
        format: 'baci.experience/v2',
        runtime: 'react-browser-sandbox/v1',
        sdkVersion: 'commerce-bridge/v1',
        entry: 'app.tsx',
        files: [{ path: 'app.tsx', content: 'export default ()=>null' }],
        packages: [],
        routes: [{ path, view }],
        capabilities: [],
        assets: [],
      },
    },
    [
      {
        path: 'app.js',
        mime: 'text/javascript',
        bytes: '\\x00',
        digest: 'a'.repeat(64),
      },
      {
        path: 'app.css',
        mime: 'text/css',
        bytes: '\\x00',
        digest: 'a'.repeat(64),
      },
    ],
  ];
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: responses.shift(), error: null }),
    limit: async () => ({ data: responses.shift(), error: null }),
  };
  const ctx = {
    actorUserId: 'owner',
    merchantId: 'merchant',
    supabase: {
      from: () => q,
      rpc: vi.fn(async () => ({ data: 'binding', error: null })),
    },
  };
  const vault = { create: vi.fn(() => 'ref'), revoke: vi.fn() };
  await createPreviewLaunch(
    ctx as never,
    { buildId: 'build' },
    vault as never,
    undefined,
    {} as never
  );
  expect(f.prerender).toHaveBeenLastCalledWith(
    ctx,
    expect.objectContaining({ routeId: path }),
    vault,
    {}
  );
  expect(vault.create).toHaveBeenCalledWith(
    expect.objectContaining({ merchantId: 'merchant' })
  );
});

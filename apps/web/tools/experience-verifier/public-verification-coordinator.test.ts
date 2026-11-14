import { beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  bind: vi.fn(),
  runtime: { catalog: vi.fn(), resolveBoundary: vi.fn() },
  makeResolver: vi.fn(),
  makeRuntime: vi.fn(),
  canonical: vi.fn(),
  fetchOutput: vi.fn(),
  fetchPages: vi.fn(),
  fetchFramework: vi.fn(),
  fetchFrames: vi.fn(),
  derive: vi.fn(),
  makeRecorder: vi.fn(),
  record: vi.fn(),
  makePublicClient: vi.fn(),
  makeRelay: vi.fn(),
  relay: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: f.makePublicClient }));
vi.mock('./public-head-resolver', () => ({
  createPublicHeadResolver: f.makeResolver,
}));
vi.mock('@/lib/experience/public-runtime', () => ({
  createPublicExperienceRuntime: f.makeRuntime,
}));
vi.mock('@/lib/experience/canonical-domain', () => ({
  resolveCanonicalBase: f.canonical,
}));
vi.mock('./public-output-fetch', () => ({ fetchPublicOutput: f.fetchOutput }));
vi.mock('./public-page-fetch', () => ({ fetchPublicPages: f.fetchPages }));
vi.mock('./public-verification-framework-assets', () => ({
  fetchFrameworkAssets: f.fetchFramework,
}));
vi.mock('./public-verification-frame', () => ({
  fetchPublicFrames: f.fetchFrames,
}));
vi.mock('./public-verification-plan', () => ({
  derivePublicVerificationPlan: f.derive,
}));
vi.mock('./public-recorder', () => ({
  createVerifierPublicRecorder: f.makeRecorder,
}));
vi.mock('./public-verification-relay', () => ({
  createPublicVerificationRelay: f.makeRelay,
}));

import { createPublicVerificationCoordinator } from './public-verification-coordinator';

const a = 'a'.repeat(64);
const binding = {
  receiptId: 'receipt',
  effectDigest: a,
  buildDigest: a,
  publicationRevision: 1,
  scriptDigest: a,
  styleDigest: a,
  assets: {},
  canonicalBase: 'https://shop.example',
};
const steps = [
  { action: 'navigate', path: '/' },
  { action: 'product', path: '/products/device' },
  { action: 'cart-add', path: '/products/device' },
  { action: 'cart-read', path: '/cart' },
  { action: 'checkout-review', path: '/checkout' },
] as const;
const plan = {
  ...binding,
  routes: [{ path: '/', canonical: 'https://shop.example/', title: 'Shop' }],
  journeySteps: [...steps],
  product: {
    id: '33333333-3333-4333-8333-333333333333',
    slug: 'device',
    path: '/products/device',
  },
};
const observation = {
  parentBuild: a,
  frameBuild: a,
  scriptDigest: a,
  styleDigest: a,
  assets: {},
  routes: [{ ...plan.routes[0], status: 200 }],
  journey: {
    steps: steps.map((step) => ({ ...step, evidenceDigest: a })),
    orderRequests: 0,
    paymentRequests: 0,
  },
  evidenceDigest: a,
};

beforeEach(() => {
  vi.clearAllMocks();
  f.makePublicClient.mockReset().mockReturnValue({});
  f.bind.mockReset().mockResolvedValue(binding);
  f.makeResolver.mockReturnValue(f.bind);
  f.makeRuntime.mockReturnValue(f.runtime);
  f.fetchOutput.mockResolvedValue([{ url: 'asset' }]);
  f.derive.mockResolvedValue(plan);
  f.fetchPages.mockResolvedValue([{ path: '/' }]);
  f.fetchFramework.mockResolvedValue([{ url: 'framework' }]);
  f.fetchFrames.mockResolvedValue([{ url: 'frame' }]);
  f.record.mockReset().mockResolvedValue(undefined);
  f.makeRecorder.mockResolvedValue(f.record);
  f.makeRelay.mockReturnValue(f.relay);
});

it('uses owner and anonymous clients for distinct reads and records only after the trusted observer succeeds', async () => {
  const owner = {};
  const anonymous = {};
  const pool = {};
  const observe = vi.fn(async () => observation);
  f.makePublicClient.mockReturnValue(anonymous);
  const verify = await createPublicVerificationCoordinator({
    owner: owner as never,
    supabase: {
      url: 'https://project.supabase.co',
      anonKey: 'sb_publishable_synthetic123',
    },
    pool: pool as never,
    rootDomain: 'example.com',
    executionOrigin: 'https://runtime.other-example.com',
    observe,
  });
  await expect(verify('approval')).resolves.toMatchObject({
    status: 'verified',
  });
  expect(f.makeResolver).toHaveBeenCalledWith(owner, anonymous, 'example.com');
  expect(f.makePublicClient).toHaveBeenCalledWith(
    'https://project.supabase.co',
    'sb_publishable_synthetic123',
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
  expect(f.makeRuntime).toHaveBeenCalledWith(
    expect.objectContaining({
      client: anonymous,
      runtimeBase: 'https://runtime.other-example.com',
    })
  );
  expect(f.derive).toHaveBeenCalledWith(binding, f.runtime);
  expect(f.fetchOutput).toHaveBeenCalledWith(
    binding,
    'https://runtime.other-example.com'
  );
  expect(f.fetchPages).toHaveBeenCalledWith(binding.canonicalBase, plan.routes);
  expect(observe).toHaveBeenCalledWith(
    binding,
    [{ url: 'asset' }],
    [{ path: '/' }],
    plan,
    f.relay,
    [{ url: 'framework' }],
    [{ url: 'frame' }]
  );
  expect(f.fetchFramework).toHaveBeenCalledWith(binding.canonicalBase, [
    { path: '/' },
  ]);
  expect(f.fetchFrames).toHaveBeenCalledWith(
    binding,
    'https://runtime.other-example.com',
    plan.routes
  );
  expect(f.makeRelay).toHaveBeenCalledWith({
    binding,
    product: plan.product,
    paths: plan.routes.map((route) => route.path),
    supabase: {
      url: 'https://project.supabase.co',
      anonKey: 'sb_publishable_synthetic123',
    },
  });
  expect(f.bind).toHaveBeenCalledTimes(2);
  expect(f.record).toHaveBeenCalledWith(
    expect.objectContaining({
      receiptId: 'receipt',
      effectDigest: a,
      markerDigest: expect.any(String),
    })
  );
});

it('does not record when the trusted browser refuses to observe', async () => {
  const verify = await createPublicVerificationCoordinator({
    owner: {} as never,
    supabase: {
      url: 'https://project.supabase.co',
      anonKey: 'sb_publishable_synthetic123',
    },
    pool: {} as never,
    rootDomain: 'example.com',
    executionOrigin: 'https://runtime.other-example.com',
    observe: async () => {
      throw Error('OBSERVER_UNAVAILABLE');
    },
  });
  await expect(verify('approval')).rejects.toThrow('OBSERVER_UNAVAILABLE');
  expect(f.record).not.toHaveBeenCalled();
});

it('does not invoke the browser or record a proof when framework acquisition fails', async () => {
  f.fetchFramework.mockRejectedValueOnce(Error('PUBLIC_FETCH_FAILED'));
  const observe = vi.fn();
  const verify = await createPublicVerificationCoordinator({
    owner: {} as never,
    supabase: {
      url: 'https://project.supabase.co',
      anonKey: 'sb_publishable_synthetic123',
    },
    pool: {} as never,
    rootDomain: 'example.com',
    executionOrigin: 'https://runtime.other-example.com',
    observe,
  });
  await expect(verify('approval')).rejects.toThrow('PUBLIC_FETCH_FAILED');
  expect(observe).not.toHaveBeenCalled();
  expect(f.record).not.toHaveBeenCalled();
});

it('rejects secret or legacy privileged keys before creating any public client', async () => {
  for (const anonKey of [
    'sb_secret_sensitive',
    'service_role',
    'ey.fake.jwt',
  ]) {
    await expect(
      createPublicVerificationCoordinator({
        owner: {} as never,
        supabase: { url: 'https://project.supabase.co', anonKey },
        pool: {} as never,
        rootDomain: 'example.com',
        executionOrigin: 'https://runtime.other-example.com',
        observe: async () => ({}),
      })
    ).rejects.toThrow('INVALID_PUBLIC_CLIENT');
  }
  expect(f.makePublicClient).not.toHaveBeenCalled();
});

import { beforeEach, expect, it, vi } from 'vitest';
import {
  fixtureCatalog,
  fixtureManifest,
} from '../../../tests/experience-browser/fixtures/qualification-fixtures';
import { createLocalExperienceRuntime } from './local-owner-runtime';

const authorize = vi.hoisted(() => vi.fn());
vi.mock('./authorization', () => ({ requireExperienceOwner: authorize }));
vi.mock('./preview-launch', () => ({
  createPreviewLaunch: async () => ({
    bindingId: 'issued-binding',
    resources: [],
    bootstrap: {
      catalog: fixtureCatalog,
      capabilities: [],
      route: {
        epoch: 1,
        routeId: 'home',
        canonicalPath: '/',
        params: {},
        publicDataRevision: 'r',
      },
    },
  }),
}));
beforeEach(() => authorize.mockReset());

it('local preview composition cannot select a hosted execution/presentation origin', () => {
  expect(() =>
    createLocalExperienceRuntime({} as never, 'https://merchant.invalid')
  ).toThrow('Local preview origin required');
});
it('does not return preview bootstrap if owner authority is revoked during descriptor queries', async () => {
  const manifest = fixtureManifest('device-configurator');
  const results = [
    { job_id: 'job' },
    { artifact_id: 'artifact' },
    { manifest },
  ];
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: results.shift(), error: null }),
  };
  const ctx = {
    merchantId: 'merchant',
    actorUserId: 'owner',
    supabase: { from: () => q },
  };
  authorize
    .mockResolvedValueOnce(ctx)
    .mockRejectedValueOnce(Error('NOT_FOUND'));
  const revoke = vi.fn();
  const runtime = createLocalExperienceRuntime(
    { revoke } as never,
    'http://127.0.0.1:4100/qa1'
  );
  await expect(
    runtime.createPreviewLaunch(ctx as never, {
      buildId: 'build',
      routeId: 'home',
    })
  ).rejects.toThrow('NOT_FOUND');
  expect(revoke).toHaveBeenCalledExactlyOnceWith('issued-binding');
});

it.each([
  0, 1, 2,
])('revokes a staged launch if descriptor query %i fails', async (failureAt) => {
  const results = [
    { job_id: 'job' },
    { artifact_id: 'artifact' },
    { manifest: fixtureManifest('device-configurator') },
  ];
  let index = 0;
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () =>
      index++ === failureAt
        ? { data: null, error: { message: 'synthetic query failure' } }
        : { data: results[index - 1], error: null },
  };
  const ctx = {
    merchantId: 'merchant',
    actorUserId: 'owner',
    supabase: { from: () => q },
  };
  authorize.mockResolvedValue(ctx);
  const revoke = vi.fn();
  const runtime = createLocalExperienceRuntime(
    { revoke } as never,
    'http://127.0.0.1:4100/qa1'
  );
  await expect(
    runtime.createPreviewLaunch(ctx as never, {
      buildId: 'build',
      routeId: 'home',
    })
  ).rejects.toThrow('NOT_FOUND');
  expect(revoke).toHaveBeenCalledExactlyOnceWith('issued-binding');
});

it('retains the launch after successful descriptor and owner checks', async () => {
  const results = [
    { job_id: 'job' },
    { artifact_id: 'artifact' },
    { manifest: fixtureManifest('device-configurator') },
  ];
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: results.shift(), error: null }),
  };
  const ctx = {
    merchantId: 'merchant',
    actorUserId: 'owner',
    supabase: { from: () => q },
  };
  authorize.mockResolvedValue(ctx);
  const revoke = vi.fn();
  const runtime = createLocalExperienceRuntime(
    { revoke } as never,
    'http://127.0.0.1:4100/qa1'
  );
  const result = await runtime.createPreviewLaunch(ctx as never, {
    buildId: 'build',
    routeId: 'home',
  });
  expect(result).toMatchObject({
    bindingId: 'issued-binding',
    merchantId: 'merchant',
  });
  expect(revoke).not.toHaveBeenCalled();
});

it('uses a declared initial route when the owner client omits its route locator', async () => {
  const manifest = fixtureManifest('device-configurator');
  manifest.routes = [{ path: '/pages/story', view: 'editorial' }];
  const results = [
    { job_id: 'job' },
    { artifact_id: 'artifact' },
    { manifest },
  ];
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: results.shift(), error: null }),
  };
  const ctx = {
    merchantId: 'merchant',
    actorUserId: 'owner',
    supabase: { from: () => q },
  };
  authorize.mockResolvedValue(ctx);
  const runtime = createLocalExperienceRuntime(
    { revoke: vi.fn() } as never,
    'http://127.0.0.1:4100/qa1'
  );
  await expect(
    runtime.createPreviewLaunch(ctx as never, { buildId: 'build' })
  ).resolves.toMatchObject({ routes: manifest.routes });
});

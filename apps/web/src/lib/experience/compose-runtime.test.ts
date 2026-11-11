import { expect, it, vi } from 'vitest';
import { POST } from '../../app/api/integrations/chatgpt/builder/[tool]/route';
import {
  configureLocalExperienceBoot,
  configureProductionExperienceBoot,
  registerExperienceStartup,
} from '../../instrumentation-experience-boot';
import { generateCSP } from '../proxy/csp';
import type { ExperienceCompositionSettings } from './compose-runtime';
import { getExperienceEvidenceReader } from './evidence-runtime';
import {
  getExperienceOwnerRuntime,
  installExperienceOwnerRuntime,
} from './owner-runtime';
import { getExperienceStorefrontRuntime } from './storefront-runtime';

const id = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({
      data: { id, user_id: id },
      error: null,
    })),
  };
  const resolveUserClient = vi.fn(
    async () =>
      ({
        auth: {
          getUser: async () => ({ data: { user: { id } }, error: null }),
        },
        rpc,
        from: () => query,
      }) as never
  );
  const legacyGateway = vi.fn(async () => Response.json({ legacy: true }));
  const settings: ExperienceCompositionSettings = {
    profile: 'local-synthetic',
    hostOrigin: 'http://127.0.0.1:43174',
    runtimeBase: 'http://127.0.0.1:43175',
    authenticate: async () => ({
      actorUserId: id,
      connectionId: id,
      grantVersion: 1,
      allowedMerchantIds: [id],
      scopes: new Set([
        'storefront.read',
        'storefront.write',
        'storefront.publish',
      ]),
      allowCreateStore: false,
    }),
    legacyGateway,
    dispatcher: {
      resolveUserClient,
      finalizeBuild: vi.fn(async () => ({
        buildId: id,
        buildDigest: 'a'.repeat(64),
      })),
      preview: vi.fn(async () => ({
        evidenceId: id,
        buildId: id,
        buildDigest: 'a'.repeat(64),
        previewUrl: `http://127.0.0.1:43174/builder/experience/preview?merchant=${id}&build=${id}`,
      })),
    },
    owner: {
      createPreviewLaunch: async () => null,
      approval: {
        load: async () => null,
        confirm: async () => null,
        loadLifecycle: async () => null,
        confirmPublication: async () => null,
        confirmModeExit: async () => null,
      },
    },
    storefront: {
      loadPublishedManifest: async () => null,
      resolveBoundary: async () => null,
      catalog: async () => null,
      state: async () => ({
        active: false,
        policyRevision: '1',
        catalogRevision: '1',
      }),
    },
  };
  return { settings, resolveUserClient, legacyGateway };
}
const request = (name: string, body: unknown = { storefrontId: id }) =>
  POST(
    new Request(
      `http://127.0.0.1:43174/api/integrations/chatgpt/builder/${name}`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer synthetic.token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    ),
    { params: Promise.resolve({ tool: name }) }
  );
it('disabled Node boot has no installed authority and actual route remains 503', async () => {
  await registerExperienceStartup();
  expect((await request('get_experience_capabilities')).status).toBe(503);
  expect(getExperienceOwnerRuntime()).toBeUndefined();
});
it('concurrent Node startup installs combined HTTP dispatch, normal-owner admission and deterministic cleanup', async () => {
  const f = fixture();
  const cleanup = configureLocalExperienceBoot(f.settings);
  try {
    await Promise.all([
      registerExperienceStartup(),
      registerExperienceStartup(),
    ]);
    expect(getExperienceStorefrontRuntime()).toBe(f.settings.storefront);
    expect(getExperienceEvidenceReader()).toBeTypeOf('function');
    const r = await request('get_experience_capabilities');
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      status: 'ok',
      value: { mode: 'full-custom-code', aiProviderCalls: 0 },
    });
    expect(f.resolveUserClient).toHaveBeenCalledOnce();
    expect(f.legacyGateway).not.toHaveBeenCalled();
    expect((await request('not_a_tool')).status).toBe(404);
    expect(f.legacyGateway).not.toHaveBeenCalled();
    expect(
      (await request('apply_experience', { storefrontId: id, approved: true }))
        .status
    ).toBe(400);
    expect(f.legacyGateway).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
  expect(getExperienceOwnerRuntime()).toBeUndefined();
  expect(getExperienceStorefrontRuntime()).toBeNull();
  expect(getExperienceEvidenceReader()).toBeUndefined();
  expect((await request('get_experience_capabilities')).status).toBe(503);
});
it('rejects nonlocal profiles and leaves startup unavailable after dependency failure', async () => {
  const f = fixture();
  expect(() =>
    configureLocalExperienceBoot({
      ...f.settings,
      runtimeBase: 'https://outside.test',
    })
  ).toThrow('LOCAL_ORIGIN_REQUIRED');
  const remove = installExperienceOwnerRuntime(f.settings.owner);
  const cleanup = configureLocalExperienceBoot(f.settings);
  await registerExperienceStartup();
  expect(getExperienceOwnerRuntime()).toBe(f.settings.owner);
  expect(getExperienceEvidenceReader()).toBeUndefined();
  cleanup();
  remove();
});
it('registers explicit HTTPS production ports without granting the local feature-gate bypass', async () => {
  const f = fixture();
  const cleanup = configureProductionExperienceBoot({
    ...f.settings,
    profile: 'production',
    hostOrigin: 'https://builder.baci.test',
    runtimeBase: 'https://artifacts.execution.test',
  });
  try {
    await registerExperienceStartup();
    expect(getExperienceOwnerRuntime()).toBe(f.settings.owner);
    expect(getExperienceEvidenceReader()).toBeTypeOf('function');
    expect((await request('get_experience_capabilities')).status).toBe(503);
    for (const route of ['admin', 'auth', 'storefront'] as const) {
      const policy = generateCSP(route, false);
      const frame = policy
        .split('; ')
        .find((part) => part.startsWith('frame-src '));
      if (route === 'storefront')
        expect(frame).toContain('https://artifacts.execution.test');
      else expect(frame).not.toContain('https://artifacts.execution.test');
      expect(
        policy.split('; ').find((part) => part.startsWith('script-src '))
      ).not.toContain('https://artifacts.execution.test');
      expect(
        policy.split('; ').find((part) => part.startsWith('connect-src '))
      ).not.toContain('https://artifacts.execution.test');
    }
    expect(f.resolveUserClient).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
  expect(getExperienceOwnerRuntime()).toBeUndefined();
  expect(generateCSP('storefront', false)).not.toContain(
    'https://artifacts.execution.test'
  );
});

it('shares the trusted performance reader with the owner-web publication boundary', async () => {
  const f = fixture();
  const read = vi.fn();
  f.settings.dispatcher.readPerformance = read;
  const cleanup = configureLocalExperienceBoot(f.settings);
  try {
    await registerExperienceStartup();
    expect(getExperienceOwnerRuntime()?.readPerformance).toBe(read);
  } finally {
    cleanup();
  }
});

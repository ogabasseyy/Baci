import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runGiglTrackingCapabilityVerification } from './verify-gigl-tracking-worker-capability';

const {
  createClient,
  createScopeProbeClient,
  verifyCapability,
  verifyPathProbe,
  verifyScopeProbe,
} = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ rpc: vi.fn() })),
  createScopeProbeClient: vi.fn(() => ({ rpc: vi.fn() })),
  verifyCapability: vi.fn(),
  verifyPathProbe: vi.fn(),
  verifyScopeProbe: vi.fn(),
}));

vi.mock('@/lib/gigl-tracking-worker-client', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/gigl-tracking-worker-client')>();
  return {
    GiglWorkerTokenError: original.GiglWorkerTokenError,
    createGiglTrackingWorkerClient: createClient,
    createGiglTrackingWorkerScopeProbeClient: createScopeProbeClient,
  };
});
vi.mock('@/lib/verify-gigl-tracking-worker-capability', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('@/lib/verify-gigl-tracking-worker-capability')
    >();
  return {
    GiglWrapperSchemaMissingError: original.GiglWrapperSchemaMissingError,
    verifyGiglTrackingWorkerCapability: verifyCapability,
    verifyGiglTrackingWorkerScopePathProbe: verifyPathProbe,
    verifyGiglTrackingWorkerScopeProbe: verifyScopeProbe,
  };
});

describe('runGiglTrackingCapabilityVerification provider probe', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fails closed when the provider login probe fails', async () => {
    verifyCapability.mockResolvedValue(true);
    verifyScopeProbe.mockResolvedValue(true);
    verifyPathProbe.mockResolvedValue(true);
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCapabilityVerification({
        env: { NODE_ENV: 'test' },
        logger,
        verifyProviderAuth: async () => false,
      })
    ).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith(
      '[gigl-capability] GIGL provider login failed; verify GIGL_EMAIL, GIGL_PASSWORD, and GIGL_BASE_URL, then re-run'
    );
  });

  it('fails closed without exposing a throwing probe error', async () => {
    verifyCapability.mockResolvedValue(true);
    verifyScopeProbe.mockResolvedValue(true);
    verifyPathProbe.mockResolvedValue(true);
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCapabilityVerification({
        env: { NODE_ENV: 'test' },
        logger,
        verifyProviderAuth: async () => {
          throw new Error('provider secret detail');
        },
      })
    ).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith(
      '[gigl-capability] verification failed'
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'provider secret detail'
    );
  });

  it('skips the provider probe when the wrapper checks fail', async () => {
    verifyCapability.mockResolvedValue(false);
    verifyScopeProbe.mockResolvedValue(true);
    const verifyProviderAuth = vi.fn(async () => true);
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCapabilityVerification({
        env: { NODE_ENV: 'test' },
        logger,
        verifyProviderAuth,
      })
    ).resolves.toBe(1);

    expect(verifyProviderAuth).not.toHaveBeenCalled();
  });

  it('skips the provider probe while GIGL is disabled', async () => {
    verifyScopeProbe.mockResolvedValue(true);
    verifyPathProbe.mockResolvedValue(true);
    const verifyProviderAuth = vi.fn(async () => true);
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCapabilityVerification({
        env: { GIGL_ENABLED: 'off', NODE_ENV: 'test' },
        logger,
        verifyProviderAuth,
      })
    ).resolves.toBe(0);

    // A disabled setup may legitimately have no provider credentials
    // yet; the vacuous latch must not demand them.
    expect(verifyProviderAuth).not.toHaveBeenCalled();
  });

  it('authenticates to the provider with the installed credentials', async () => {
    // The default probe reads module-level GIGL_* constants, so reload
    // the module after stubbing the installed environment.
    vi.resetModules();
    vi.stubEnv('GIGL_BASE_URL', 'https://gigl.test');
    vi.stubEnv('GIGL_EMAIL', 'ops@example.com');
    vi.stubEnv('GIGL_PASSWORD', 's3cret');
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            status: 200,
            data: { 'access-token': 'tok', UserChannelCode: 'WEB' },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const fresh = await import(
        './verify-gigl-tracking-worker-capability'
      );
      verifyCapability.mockResolvedValue(true);
      verifyScopeProbe.mockResolvedValue(true);
      verifyPathProbe.mockResolvedValue(true);
      const logger = { error: vi.fn(), info: vi.fn() };

      await expect(
        fresh.runGiglTrackingCapabilityVerification({
          env: { NODE_ENV: 'test' },
          logger,
        })
      ).resolves.toBe(0);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://gigl.test/login');
      expect(JSON.parse(init?.body as string)).toEqual({
        email: 'ops@example.com',
        password: 's3cret',
      });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});

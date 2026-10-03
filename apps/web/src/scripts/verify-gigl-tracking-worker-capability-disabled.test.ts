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
    GiglWorkerTokenRoleError: original.GiglWorkerTokenRoleError,
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


// Disabled-branch coverage, split from
// verify-gigl-tracking-worker-capability.test.ts to keep both suites
// under the 300-line limit.
describe('runGiglTrackingCapabilityVerification (disabled)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('probes the scope hook when disabled with a usable token', async () => {
    verifyScopeProbe.mockResolvedValue(true);
    verifyPathProbe.mockResolvedValue(true);
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCapabilityVerification({
        env: { GIGL_ENABLED: 'off', NODE_ENV: 'test' },
        logger,
      })
    ).resolves.toBe(0);

    expect(logger.info).toHaveBeenCalledWith(
      '[gigl-capability] skipped while GIGL is disabled'
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[gigl-capability] scope hook verified active'
    );
    expect(verifyCapability).not.toHaveBeenCalled();
    expect(verifyScopeProbe).toHaveBeenCalledOnce();
    expect(verifyPathProbe).toHaveBeenCalledOnce();
    expect(verifyPathProbe).toHaveBeenCalledWith(
      createScopeProbeClient.mock.results[0].value
    );
  });

  it('fails closed when disabled with an unenforced path allowlist', async () => {
    verifyScopeProbe.mockResolvedValue(true);
    verifyPathProbe.mockResolvedValue(false);
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCapabilityVerification({
        env: { GIGL_ENABLED: 'off', NODE_ENV: 'test' },
        logger,
      })
    ).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith(
      '[gigl-capability] PostgREST scope hook is not enforcing the RPC path allowlist; check the hook definition and re-run'
    );
  });

  it('fails closed when disabled with a token but an inactive hook', async () => {
    verifyScopeProbe.mockResolvedValue(false);
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCapabilityVerification({
        env: { GIGL_ENABLED: '0', NODE_ENV: 'test' },
        logger,
      })
    ).resolves.toBe(1);

    // A disabled latch must not certify a token that reaches beyond the
    // five reviewed RPCs while the hook reload is still pending.
    expect(logger.error).toHaveBeenCalledWith(
      '[gigl-capability] PostgREST scope hook is not active; reload PostgREST config and re-run'
    );
  });

  it('warns when skipping with an unhealthy worker token', async () => {
    const { GiglWorkerTokenError } = await import(
      '@/lib/gigl-tracking-worker-client'
    );
    createClient.mockImplementationOnce(() => {
      throw new GiglWorkerTokenError(
        'GIGL tracking worker database capability is invalid'
      );
    });
    const logger = { error: vi.fn(), info: vi.fn() };

    // Still exit 0: a disabled setup may legitimately have no token yet,
    // and with no usable token there is nothing to abuse.
    await expect(
      runGiglTrackingCapabilityVerification({
        env: { GIGL_ENABLED: 'off', NODE_ENV: 'test' },
        logger,
      })
    ).resolves.toBe(0);

    expect(logger.info).toHaveBeenCalledWith(
      '[gigl-capability] worker token missing or expired; provision it before re-enabling GIGL'
    );
    expect(verifyScopeProbe).not.toHaveBeenCalled();
  });

  it('fails closed when disabled with a usable non-worker token', async () => {
    // A valid service_role JWT is a live credential, not a missing
    // one: the disabled smoke must not latch it vacuously.
    const { GiglWorkerTokenRoleError } = await import(
      '@/lib/gigl-tracking-worker-client'
    );
    createClient.mockImplementationOnce(() => {
      throw new GiglWorkerTokenRoleError(
        'GIGL tracking worker token is a usable non-worker JWT; refusing to scope a privileged credential to the poller'
      );
    });
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCapabilityVerification({
        env: { GIGL_ENABLED: 'off', NODE_ENV: 'test' },
        logger,
      })
    ).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith(
      '[gigl-capability] worker token is a usable non-worker JWT while GIGL is disabled; replace it with a worker-role token or remove it and re-run'
    );
    expect(verifyScopeProbe).not.toHaveBeenCalled();
  });

  it('fails closed when disabled with a non-token client error', async () => {
    // A valid JWT with a misconfigured URL must not latch vacuously:
    // the token stays usable against the correct endpoint unprobed.
    createClient.mockImplementationOnce(() => {
      throw new Error(
        'GIGL tracking worker Supabase URL must be a credential-free https:// URL'
      );
    });
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCapabilityVerification({
        env: { GIGL_ENABLED: 'off', NODE_ENV: 'test' },
        logger,
      })
    ).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith(
      '[gigl-capability] worker client misconfigured while GIGL is disabled; fix the Supabase URL/anon key and re-run'
    );
    expect(verifyScopeProbe).not.toHaveBeenCalled();
  });

  it('exits 42 when disabled and the wrapper RPCs predate the migration', async () => {
    const { GiglWrapperSchemaMissingError } = await import(
      '@/lib/verify-gigl-tracking-worker-capability'
    );
    verifyScopeProbe.mockRejectedValueOnce(
      new GiglWrapperSchemaMissingError()
    );
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCapabilityVerification({
        env: { GIGL_ENABLED: 'false', NODE_ENV: 'test' },
        logger,
      })
    ).resolves.toBe(42);

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      '[gigl-capability] wrapper RPCs not deployed yet or role grant pending; deferring to the post-migration smoke'
    );
  });
});

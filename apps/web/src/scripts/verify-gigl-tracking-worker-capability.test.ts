import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runGiglTrackingCapabilityVerification } from './verify-gigl-tracking-worker-capability';

const { createClient, verifyCapability, verifyScopeProbe } = vi.hoisted(
  () => ({
    createClient: vi.fn(() => ({ rpc: vi.fn() })),
    verifyCapability: vi.fn(),
    verifyScopeProbe: vi.fn(),
  })
);

vi.mock('@/lib/gigl-tracking-worker-client', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/gigl-tracking-worker-client')>();
  return {
    GiglWorkerTokenError: original.GiglWorkerTokenError,
    createGiglTrackingWorkerClient: createClient,
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
    verifyGiglTrackingWorkerScopeProbe: verifyScopeProbe,
  };
});

describe('runGiglTrackingCapabilityVerification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes only after the live restricted wrapper smoke succeeds', async () => {
    verifyCapability.mockResolvedValue(true);
    verifyScopeProbe.mockResolvedValue(true);
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCapabilityVerification({
        env: { NODE_ENV: 'test' },
        logger,
      })
    ).resolves.toBe(0);

    expect(createClient).toHaveBeenCalledOnce();
    expect(verifyCapability).toHaveBeenCalledOnce();
    expect(verifyScopeProbe).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(
      '[gigl-capability] restricted wrapper verified'
    );
  });

  it('fails closed when the scope hook is not enforcing', async () => {
    verifyCapability.mockResolvedValue(true);
    verifyScopeProbe.mockResolvedValue(false);
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCapabilityVerification({
        env: { NODE_ENV: 'test' },
        logger,
      })
    ).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith(
      '[gigl-capability] PostgREST scope hook is not active; reload PostgREST config and re-run'
    );
  });

  it('fails closed without exposing the credential error', async () => {
    createClient.mockImplementationOnce(() => {
      throw new Error('secret credential detail');
    });
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCapabilityVerification({
        env: { NODE_ENV: 'test' },
        logger,
      })
    ).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith(
      '[gigl-capability] verification failed'
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'secret credential detail'
    );
  });

  it('fails closed on a non-throwing failed capability probe', async () => {
    verifyCapability.mockResolvedValue(false);
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCapabilityVerification({
        env: { NODE_ENV: 'test' },
        logger,
      })
    ).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith(
      '[gigl-capability] verification failed'
    );
  });

  it('probes the scope hook when disabled with a usable token', async () => {
    verifyScopeProbe.mockResolvedValue(true);
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

  it('exits 42 when the wrapper RPCs predate the migration', async () => {
    const { GiglWrapperSchemaMissingError } = await import(
      '@/lib/verify-gigl-tracking-worker-capability'
    );
    verifyCapability.mockRejectedValueOnce(
      new GiglWrapperSchemaMissingError()
    );
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCapabilityVerification({
        env: { NODE_ENV: 'test' },
        logger,
      })
    ).resolves.toBe(42);

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      '[gigl-capability] wrapper RPCs not deployed yet or role grant pending; deferring to the post-migration smoke'
    );
  });
});

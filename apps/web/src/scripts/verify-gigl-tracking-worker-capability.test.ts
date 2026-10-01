import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runGiglTrackingCapabilityVerification } from './verify-gigl-tracking-worker-capability';

const { createClient, verifyCapability, verifyScopeProbe } = vi.hoisted(
  () => ({
    createClient: vi.fn(() => ({ rpc: vi.fn() })),
    verifyCapability: vi.fn(),
    verifyScopeProbe: vi.fn(),
  })
);

vi.mock('@/lib/gigl-tracking-worker-client', () => ({
  createGiglTrackingWorkerClient: createClient,
}));
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

  it('does not require credentials when GIGL is explicitly disabled', async () => {
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
    expect(verifyCapability).not.toHaveBeenCalled();
    expect(verifyScopeProbe).not.toHaveBeenCalled();
  });

  it('warns when skipping with an unhealthy worker token', async () => {
    createClient.mockImplementationOnce(() => {
      throw new Error('GIGL tracking worker database capability is invalid');
    });
    const logger = { error: vi.fn(), info: vi.fn() };

    // Still exit 0: a disabled setup may legitimately have no token yet.
    await expect(
      runGiglTrackingCapabilityVerification({
        env: { GIGL_ENABLED: 'off', NODE_ENV: 'test' },
        logger,
      })
    ).resolves.toBe(0);

    expect(logger.info).toHaveBeenCalledWith(
      '[gigl-capability] worker token missing or expired; provision it before re-enabling GIGL'
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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runGiglTrackingCapabilityVerification } from './verify-gigl-tracking-worker-capability';

const {
  createClient,
  createScopeProbeClient,
  verifyCapability,
  verifyDelegationCanary,
  verifyPathProbe,
  verifyScopeProbe,
} = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ rpc: vi.fn() })),
  createScopeProbeClient: vi.fn(() => ({ rpc: vi.fn() })),
  verifyCapability: vi.fn(),
  verifyDelegationCanary: vi.fn(),
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
    verifyGiglTrackingWorkerDelegationCanary: verifyDelegationCanary,
    verifyGiglTrackingWorkerScopePathProbe: verifyPathProbe,
    verifyGiglTrackingWorkerScopeProbe: verifyScopeProbe,
  };
});

describe('runGiglTrackingCapabilityVerification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes only after the live restricted wrapper smoke succeeds', async () => {
    verifyCapability.mockResolvedValue(true);
    verifyDelegationCanary.mockResolvedValue(true);
    verifyScopeProbe.mockResolvedValue(true);
    verifyPathProbe.mockResolvedValue(true);
    const verifyProviderAuth = vi.fn(async () => true);
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCapabilityVerification({
        env: { NODE_ENV: 'test' },
        logger,
        verifyProviderAuth,
      })
    ).resolves.toBe(0);

    expect(createClient).toHaveBeenCalledOnce();
    expect(verifyCapability).toHaveBeenCalledOnce();
    expect(verifyDelegationCanary).toHaveBeenCalledOnce();
    // The canary runs through the RESTRICTED client (mapped, hook
    // allowlisted release path) — the same client as the capability
    // probe, not the unmapped scope-probe client.
    expect(verifyDelegationCanary).toHaveBeenCalledWith(
      createClient.mock.results[0].value
    );
    expect(verifyScopeProbe).toHaveBeenCalledOnce();
    expect(verifyPathProbe).toHaveBeenCalledOnce();
    // The path probe must receive the UNMAPPED client: the restricted
    // client would remap its inner RPC name to the approved wrapper
    // and the hook denial would be unobservable.
    expect(createScopeProbeClient).toHaveBeenCalledWith({
      NODE_ENV: 'test',
    });
    expect(verifyPathProbe).toHaveBeenCalledWith(
      createScopeProbeClient.mock.results[0].value
    );
    expect(verifyPathProbe.mock.calls[0][0]).not.toBe(
      createClient.mock.results[0].value
    );
    expect(verifyProviderAuth).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(
      '[gigl-capability] restricted wrapper verified'
    );
  });

  it('fails closed when the hook stops enforcing the path allowlist', async () => {
    verifyCapability.mockResolvedValue(true);
    verifyDelegationCanary.mockResolvedValue(true);
    verifyScopeProbe.mockResolvedValue(true);
    verifyPathProbe.mockResolvedValue(false);
    const verifyProviderAuth = vi.fn(async () => true);
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCapabilityVerification({
        env: { NODE_ENV: 'test' },
        logger,
        verifyProviderAuth,
      })
    ).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith(
      '[gigl-capability] PostgREST scope hook is not enforcing the RPC path allowlist; check the hook definition and re-run'
    );
    expect(verifyProviderAuth).not.toHaveBeenCalled();
  });

  it('fails closed when the scope hook is not enforcing', async () => {
    verifyCapability.mockResolvedValue(true);
    verifyDelegationCanary.mockResolvedValue(true);
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
    expect(verifyPathProbe).not.toHaveBeenCalled();
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

  it('fails closed when the wrapper cannot delegate to its inner RPC', async () => {
    verifyCapability.mockResolvedValue(true);
    verifyDelegationCanary.mockResolvedValue(false);
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCapabilityVerification({
        env: { NODE_ENV: 'test' },
        logger,
      })
    ).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith(
      '[gigl-capability] wrapper delegation check failed; the claim wrapper validates input but cannot reach its inner RPC — check the elevation grant and re-run'
    );
    expect(verifyScopeProbe).not.toHaveBeenCalled();
  });

  // Disabled-branch coverage lives in
  // verify-gigl-tracking-worker-capability-disabled.test.ts (split to
  // keep both suites under the 300-line limit).

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

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  createJumiaCredentialServiceClient: vi.fn(),
  syncJumiaOrdersForActiveIntegrations: vi.fn(),
}));

vi.mock('../lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));

vi.mock('../lib/jumia/server-credential-client', () => ({
  createJumiaCredentialServiceClient:
    mocks.createJumiaCredentialServiceClient,
}));

vi.mock('../lib/jumia/order-sync', () => ({
  syncJumiaOrdersForActiveIntegrations:
    mocks.syncJumiaOrdersForActiveIntegrations,
}));

import { runJumiaOrderSyncCli } from './sync-jumia-orders';

describe('runJumiaOrderSyncCli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the Jumia sync and exits cleanly when there are no errors', async () => {
    const supabase = { service: true };
    const credentialClient = { credentialService: true };
    const result = {
      integrations: 1,
      synced: 2,
      canonicalCreated: 1,
      canonicalUpdated: 1,
      notified: 1,
      stockUpdated: 0,
      orderErrors: 0,
      errors: [],
    };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.createServiceClient.mockReturnValue(supabase);
    mocks.createJumiaCredentialServiceClient.mockReturnValue(credentialClient);
    mocks.syncJumiaOrdersForActiveIntegrations.mockResolvedValue(result);

    const exitCode = await runJumiaOrderSyncCli();

    expect(exitCode).toBe(0);
    expect(mocks.syncJumiaOrdersForActiveIntegrations).toHaveBeenCalledWith(
      supabase,
      { credentialClient }
    );
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] ?? '{}')).toMatchObject(result);
  });

  it('returns a non-zero exit code when any integration fails', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.createServiceClient.mockReturnValue({ service: true });
    mocks.syncJumiaOrdersForActiveIntegrations.mockResolvedValue({
      integrations: 1,
      synced: 0,
      canonicalCreated: 0,
      canonicalUpdated: 0,
      notified: 0,
      stockUpdated: 0,
      orderErrors: 0,
      errors: ['merchant-1: reauthorization required'],
    });

    const exitCode = await runJumiaOrderSyncCli();

    expect(exitCode).toBe(1);
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
      errors: ['merchant-1: reauthorization required'],
    });
  });

  it('does not fail the worker when only order-level errors were recovered', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.createServiceClient.mockReturnValue({ service: true });
    mocks.syncJumiaOrdersForActiveIntegrations.mockResolvedValue({
      integrations: 1,
      synced: 4,
      canonicalCreated: 3,
      canonicalUpdated: 1,
      notified: 2,
      orderErrors: 1,
      errors: [],
    });

    const exitCode = await runJumiaOrderSyncCli();

    expect(exitCode).toBe(0);
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
      errors: [],
      orderErrors: 1,
    });
  });

  it('returns a non-zero exit code when integration errors exist with order errors', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.createServiceClient.mockReturnValue({ service: true });
    mocks.syncJumiaOrdersForActiveIntegrations.mockResolvedValue({
      integrations: 2,
      synced: 3,
      canonicalCreated: 2,
      canonicalUpdated: 1,
      notified: 1,
      orderErrors: 2,
      errors: ['merchant-2: API timeout'],
    });

    const exitCode = await runJumiaOrderSyncCli();

    expect(exitCode).toBe(1);
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
      errors: ['merchant-2: API timeout'],
      orderErrors: 2,
    });
  });

  it('runs the sync command with the react-server condition', () => {
    const packageJson = JSON.parse(
      readFileSync(
        path.join(import.meta.dirname, '../../package.json'),
        'utf8'
      )
    ) as { scripts: Record<string, string> };

    // The sync transitively imports server-only modules; without the
    // condition the standalone command exits before syncing.
    expect(packageJson.scripts['sync:jumia-orders']).toContain(
      '--conditions=react-server'
    );
  });
});

describe('sync-jumia-orders production env validation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('GITHUB_ACTIONS', 'false');
    vi.stubEnv('QUIZ_PHASE', '1a');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
    vi.stubEnv('SUPABASE_JUMIA_CREDENTIAL_KEY', 'jumia-credential-key');
    delete process.env.QUIZ_RPC_SERVER_SECRET;
    delete process.env.SUPABASE_JWT_SECRET;
    delete process.env.SUPABASE_AGENTIC_JWT_PRIVATE_JWK;
    delete process.env.BACI_WORKER_PROFILE;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('succeeds in production phase 1a without QUIZ_RPC_SERVER_SECRET when BACI_WORKER_PROFILE is jumia-order-sync', async () => {
    vi.stubEnv('BACI_WORKER_PROFILE', 'jumia-order-sync');
    vi.doUnmock('../lib/supabase/service');
    vi.doUnmock('../lib/jumia/server-credential-client');
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn(() => ({ mockedSupabase: true })),
    }));
    vi.doMock('../lib/jumia/order-sync', () => ({
      syncJumiaOrdersForActiveIntegrations: vi.fn().mockResolvedValue({
        integrations: 0,
        synced: 0,
        canonicalCreated: 0,
        canonicalUpdated: 0,
        notified: 0,
        stockUpdated: 0,
        orderErrors: 0,
        errors: [],
      }),
    }));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runJumiaOrderSyncCli: runWithRealEnv } = await import(
      './sync-jumia-orders'
    );

    await expect(runWithRealEnv()).resolves.toBe(0);
  });

  it('fails in production phase 1a without QUIZ_RPC_SERVER_SECRET when BACI_WORKER_PROFILE is missing (web runtime)', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', 'jwt-secret');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.doUnmock('../lib/supabase/service');
    vi.doUnmock('../lib/jumia/server-credential-client');
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn(() => ({ mockedSupabase: true })),
    }));
    vi.doMock('../lib/jumia/order-sync', () => ({
      syncJumiaOrdersForActiveIntegrations: vi.fn(),
    }));

    const { runJumiaOrderSyncCli: runWithRealEnv } = await import(
      './sync-jumia-orders'
    );

    await expect(runWithRealEnv()).rejects.toThrow(
      /QUIZ_RPC_SERVER_SECRET is required in production for negotiated checkout proofs/
    );
  });
});

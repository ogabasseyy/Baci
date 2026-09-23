import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  syncJumiaOrdersForActiveIntegrations: vi.fn(),
}));

vi.mock('../lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
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
    mocks.syncJumiaOrdersForActiveIntegrations.mockResolvedValue(result);

    const exitCode = await runJumiaOrderSyncCli();

    expect(exitCode).toBe(0);
    expect(mocks.syncJumiaOrdersForActiveIntegrations).toHaveBeenCalledWith(
      supabase
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
});

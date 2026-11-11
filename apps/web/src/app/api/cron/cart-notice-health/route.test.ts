import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
  loggerError: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError },
}));

vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: mocks.createPublicClient,
}));

import { GET } from './route';

const healthy = {
  healthy: true,
  staleUndelivered: 0,
  deadLettered24h: 0,
};

function request(authorization?: string): NextRequest {
  return new NextRequest('https://example.com/api/cron/cart-notice-health', {
    headers: authorization ? { authorization } : {},
  });
}

describe('GET /api/cron/cart-notice-health', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'cron-test-secret');
    mocks.createPublicClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: healthy, error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('rejects a caller without the cron secret before reading health', async () => {
    for (const header of [undefined, 'Bearer wrong', 'cron-test-secret']) {
      const response = await GET(request(header));
      expect(response.status).toBe(401);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects every caller when no cron secret is configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const response = await GET(request('Bearer '));
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('reports healthy when nothing is stale or abandoned', async () => {
    const response = await GET(request('Bearer cron-test-secret'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ healthy: true });
    expect(mocks.rpc).toHaveBeenCalledWith('commerce_cart_publish_health');
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('fails and logs the fault when notices sit undelivered', async () => {
    mocks.rpc.mockResolvedValue({
      data: { ...healthy, healthy: false, staleUndelivered: 7 },
      error: null,
    });
    const response = await GET(request('Bearer cron-test-secret'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      healthy: false,
      staleUndelivered: 7,
      deadLettered24h: 0,
    });
    expect(mocks.loggerError).toHaveBeenCalledWith({
      message: 'shared-cart notice_delivery_fault',
      reason: 'notices_not_delivered',
      staleUndelivered: 7,
      deadLettered24h: 0,
    });
  });

  it('fails on abandoned notices even if the database reports healthy', async () => {
    mocks.rpc.mockResolvedValue({
      data: { ...healthy, deadLettered24h: 2 },
      error: null,
    });
    const response = await GET(request('Bearer cron-test-secret'));
    expect(response.status).toBe(503);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'notices_not_delivered',
        deadLettered24h: 2,
      })
    );
  });

  it('fails without leaking database details when the health read errors', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '42883', message: 'function does not exist' },
    });
    const response = await GET(request('Bearer cron-test-secret'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Cart notice health check failed',
    });
    expect(mocks.loggerError).toHaveBeenCalledWith({
      message: 'shared-cart notice_delivery_fault',
      reason: 'health_rpc_failed',
      pgCode: '42883',
    });
  });

  it('fails when the health read throws', async () => {
    mocks.rpc.mockRejectedValue(new Error('network down'));
    const response = await GET(request('Bearer cron-test-secret'));
    expect(response.status).toBe(500);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'health_rpc_failed' })
    );
  });

  it.each([
    null,
    'ok',
    { healthy: true },
    { healthy: true, staleUndelivered: 0 },
    { ...healthy, staleUndelivered: -1 },
    { ...healthy, deadLettered24h: '0' },
    { ...healthy, healthy: 'true' },
  ])('fails on a malformed health result: %j', async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    const response = await GET(request('Bearer cron-test-secret'));
    expect(response.status).toBe(500);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'invalid_health_result' })
    );
  });
});

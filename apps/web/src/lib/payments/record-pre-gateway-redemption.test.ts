import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import { recordPreGatewayRedemption } from './record-pre-gateway-redemption';

describe('recordPreGatewayRedemption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockRejectedValue(
      new Error('Cookie authentication unavailable for bearer request')
    );
    mocks.rpc.mockResolvedValue({
      data: { wallet: 20000, savings: 0 },
      error: null,
    });
  });

  it('uses the authenticated ledger-derived RPC without sending caller-selected amounts', async () => {
    await recordPreGatewayRedemption('order-1', 50000, 0, 20000, {
      rpc: mocks.rpc,
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      'record_order_store_credit',
      { p_order_id: 'order-1' }
    );
  });

  it('does nothing when no redemption occurred', async () => {
    await recordPreGatewayRedemption('order-1', 50000, 0, 0, {
      rpc: mocks.rpc,
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('keeps unexpected database failures generic', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'private database detail' },
    });
    await expect(
      recordPreGatewayRedemption('order-1', 50000, 0, 20000, { rpc: mocks.rpc })
    ).rejects.toThrow('Store credit could not be confirmed');
  });

  it.each([
    { data: null, error: null },
    { data: { wallet: 0, savings: 0 }, error: null },
    { data: { wallet: 20000, savings: 5000 }, error: null },
  ])('stops provider handoff when credit is not confirmed: %j', async (result) => {
    mocks.rpc.mockResolvedValue(result);
    await expect(
      recordPreGatewayRedemption('order-1', 50000, 0, 20000, { rpc: mocks.rpc })
    ).resolves.toMatchObject({
      status: 409,
      code: 'STORE_CREDIT_REVIEW_REQUIRED',
    });
  });

  it.each([
    [
      '40001',
      'Store credit retry required',
      503,
      'STORE_CREDIT_RETRY_REQUIRED',
    ],
    [
      '40001',
      'Store credit reconciliation required',
      409,
      'STORE_CREDIT_REVIEW_REQUIRED',
    ],
    [
      '23514',
      'Store credit reconciliation required',
      409,
      'STORE_CREDIT_REVIEW_REQUIRED',
    ],
  ])('maps store credit error %s (%s) to %s', async (code, message, status, responseCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message } });
    await expect(
      recordPreGatewayRedemption('order-1', 50000, 0, 20000, { rpc: mocks.rpc })
    ).resolves.toMatchObject({ status, code: responseCode });
  });

  it('accepts a confirmed combined savings and wallet debit', async () => {
    mocks.rpc.mockResolvedValue({
      data: { wallet: 20000, savings: 5000 },
      error: null,
    });
    await expect(
      recordPreGatewayRedemption('order-1', 50000, 5000, 20000, {
        rpc: mocks.rpc,
      })
    ).resolves.toBeUndefined();
  });

  it('routes invalid combined amounts to review before querying the ledger', async () => {
    await expect(
      recordPreGatewayRedemption('order-1', 10000, 6000, 5000, {
        rpc: mocks.rpc,
      })
    ).resolves.toMatchObject({
      status: 409,
      code: 'STORE_CREDIT_REVIEW_REQUIRED',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

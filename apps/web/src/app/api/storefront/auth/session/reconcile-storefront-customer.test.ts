import type { User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileStorefrontCustomer } from './reconcile-storefront-customer';

const baseCustomer = {
  id: 'cust-1',
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada@example.com',
  phone: '+2348000000000',
  address: null,
  date_of_birth: null,
  saved_addresses: [],
  store_credit: 0,
  total_orders: 0,
  total_spent: 0,
  created_at: '2026-05-20T00:00:00.000Z',
};

function makeChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue(result),
  };
  return chain;
}

describe('reconcileStorefrontCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing customer without invoking RPCs or inserts', async () => {
    const selectChain = makeChain({ data: baseCustomer, error: null });
    const mockFrom = vi.fn().mockReturnValue(selectChain);
    const mockRpc = vi.fn();

    const result = await reconcileStorefrontCustomer(
      { from: mockFrom, rpc: mockRpc } as never,
      'merchant-1',
      { id: 'user-1', email: 'ada@example.com', user_metadata: {} } as User
    );

    expect(result).toEqual(baseCustomer);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('logs and returns null on non-PGRST116 customer fetch errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const selectChain = makeChain({
      data: null,
      error: { code: '500', message: 'db down' },
    });
    const mockFrom = vi.fn().mockReturnValue(selectChain);
    const mockRpc = vi.fn();

    const result = await reconcileStorefrontCustomer(
      { from: mockFrom, rpc: mockRpc } as never,
      'merchant-1',
      { id: 'user-1', email: 'ada@example.com', user_metadata: {} } as User
    );

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Customer fetch error:',
      expect.objectContaining({ code: '500' })
    );
    consoleSpy.mockRestore();
  });

  it('claims phone-auth customer and falls back to direct insert when no phone is present', async () => {
    const missingChain = makeChain({
      data: null,
      error: { code: 'PGRST116', message: 'No rows' },
    });
    const claimedChain = makeChain({
      data: { ...baseCustomer, email: null },
      error: null,
    });
    const mockFrom = vi
      .fn()
      .mockReturnValueOnce(missingChain)
      .mockReturnValueOnce(claimedChain);
    const mockRpc = vi
      .fn()
      .mockResolvedValueOnce({ data: 'cust-1', error: null });

    const claimed = await reconcileStorefrontCustomer(
      { from: mockFrom, rpc: mockRpc } as never,
      'merchant-1',
      {
        id: 'user-1',
        email: null,
        phone: '+2348000000000',
        user_metadata: { full_name: 'Ada Lovelace' },
      } as unknown as User
    );

    expect(mockRpc).toHaveBeenCalledWith(
      'claim_customer_on_phone_auth',
      expect.objectContaining({
        p_merchant_id: 'merchant-1',
        p_phone: '+2348000000000',
        p_user_id: 'user-1',
      })
    );
    expect(claimed).toEqual({ ...baseCustomer, email: null });

    const missingChain2 = makeChain({
      data: null,
      error: { code: 'PGRST116', message: 'No rows' },
    });
    const insertedChain = makeChain({
      data: { ...baseCustomer, email: null, phone: null },
      error: null,
    });
    const mockFrom2 = vi
      .fn()
      .mockReturnValueOnce(missingChain2)
      .mockReturnValueOnce(insertedChain);

    const inserted = await reconcileStorefrontCustomer(
      { from: mockFrom2, rpc: vi.fn() } as never,
      'merchant-1',
      {
        id: 'user-2',
        email: null,
        user_metadata: { first_name: 'Ada' },
      } as unknown as User
    );

    expect(inserted).toEqual({ ...baseCustomer, email: null, phone: null });
  });

  it('upserts email customer and backfills missing split names', async () => {
    const missingChain = makeChain({
      data: null,
      error: { code: 'PGRST116', message: 'No rows' },
    });
    const linkedChain = makeChain({
      data: { ...baseCustomer, first_name: null, last_name: null },
      error: null,
    });
    const updatedChain = makeChain({ data: baseCustomer, error: null });
    const mockFrom = vi
      .fn()
      .mockReturnValueOnce(missingChain)
      .mockReturnValueOnce(linkedChain)
      .mockReturnValueOnce(updatedChain);
    const mockRpc = vi.fn().mockResolvedValueOnce({ error: null });

    const result = await reconcileStorefrontCustomer(
      { from: mockFrom, rpc: mockRpc } as never,
      'merchant-1',
      {
        id: 'user-1',
        email: 'ada@example.com',
        user_metadata: { first_name: 'Ada', last_name: 'Lovelace' },
      } as unknown as User
    );

    expect(mockRpc).toHaveBeenCalledWith(
      'upsert_customer_on_auth',
      expect.objectContaining({
        p_email: 'ada@example.com',
        p_merchant_id: 'merchant-1',
      })
    );
    expect(updatedChain.update).toHaveBeenCalledWith({
      first_name: 'Ada',
      last_name: 'Lovelace',
    });
    expect(result).toEqual(baseCustomer);
  });
});

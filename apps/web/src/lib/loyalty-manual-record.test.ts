import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/supabase';
import { createLoyaltyRecordWithRetry } from './loyalty-manual-record';

const mocks = vi.hoisted(() => {
  const mockSingle = vi.fn();
  const mockMaybeSingle = vi.fn();
  const mockInsert = vi.fn();
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
    insert: mockInsert,
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  mockInsert.mockReturnValue(chain);
  return {
    mockSingle,
    mockMaybeSingle,
    mockInsert,
    mockSupabase: { from: vi.fn(() => chain) },
  };
});

const MERCHANT_ID = '01aa0000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '01aa0000-0000-4000-8000-000000000011';

function supabaseClient() {
  return mocks.mockSupabase as unknown as SupabaseClient<Database>;
}

describe('createLoyaltyRecordWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the record when the minted code is free', async () => {
    mocks.mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.mockSingle.mockResolvedValue({
      data: {
        id: 'loyalty-1',
        points_balance: 0,
        lifetime_points: 0,
        current_tier: 'Bronze',
      },
      error: null,
    });

    const record = await createLoyaltyRecordWithRetry(
      supabaseClient(),
      MERCHANT_ID,
      CUSTOMER_ID
    );

    expect(record?.id).toBe('loyalty-1');
    expect(mocks.mockInsert).toHaveBeenCalledTimes(1);
  });

  it('mints again when the probe finds the code taken', async () => {
    mocks.mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'other' },
      error: null,
    });
    mocks.mockSingle.mockResolvedValue({
      data: {
        id: 'loyalty-1',
        points_balance: 0,
        lifetime_points: 0,
        current_tier: 'Bronze',
      },
      error: null,
    });

    const record = await createLoyaltyRecordWithRetry(
      supabaseClient(),
      MERCHANT_ID,
      CUSTOMER_ID
    );

    expect(record?.id).toBe('loyalty-1');
    expect(mocks.mockInsert).toHaveBeenCalledTimes(1);
    expect(mocks.mockMaybeSingle).toHaveBeenCalledTimes(2);
  });

  it('adopts a concurrently created row on unique violation', async () => {
    mocks.mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          id: 'loyalty-2',
          points_balance: 50,
          lifetime_points: 50,
          current_tier: 'Bronze',
        },
        error: null,
      });
    mocks.mockSingle.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });

    const record = await createLoyaltyRecordWithRetry(
      supabaseClient(),
      MERCHANT_ID,
      CUSTOMER_ID
    );

    expect(record?.id).toBe('loyalty-2');
  });

  it('returns null after exhausting retries on repeated collisions', async () => {
    mocks.mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.mockSingle.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });

    const record = await createLoyaltyRecordWithRetry(
      supabaseClient(),
      MERCHANT_ID,
      CUSTOMER_ID
    );

    expect(record).toBeNull();
    expect(mocks.mockInsert).toHaveBeenCalledTimes(5);
  });

  it('returns null immediately on a non-collision error', async () => {
    mocks.mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.mockSingle.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });

    const record = await createLoyaltyRecordWithRetry(
      supabaseClient(),
      MERCHANT_ID,
      CUSTOMER_ID
    );

    expect(record).toBeNull();
    expect(mocks.mockInsert).toHaveBeenCalledTimes(1);
  });
});

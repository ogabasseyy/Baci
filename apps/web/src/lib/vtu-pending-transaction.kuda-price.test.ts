import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearKudaBillItemPriceCacheForTests } from '@/lib/kuda-bill-item-price';
import { KUDA_BILL_PRICE_CHANGED_MESSAGE } from '@/lib/kuda-bill-item-price-messages';
import { preparePendingVtuTransaction } from '@/lib/vtu-pending-transaction';
import { createMockSupabase } from './vtu-pending-transaction.test-support';

const { mockGetBillersByType, mockCalculateCommerce } = vi.hoisted(() => ({
  mockGetBillersByType: vi.fn(),
  mockCalculateCommerce: vi.fn(() =>
    Promise.resolve({ merchantEarning: 10, platformEarning: 5 })
  ),
}));

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue(null),
  getCurrentSlugForAliasStrict: vi.fn(),
}));

vi.mock('@/lib/kuda', () => ({
  NetworkProvider: {
    MTN: 'MTN',
    AIRTEL: 'AIRTEL',
    GLO: 'GLO',
    MOBILE_9: '9MOBILE',
  },
  formatPhoneNumber: (value: string) => value,
  isValidPhoneNumber: () => true,
  generateRequestRef: () => 'VTU-REF-123',
  getDataProviders: vi.fn().mockResolvedValue([]),
  getBillersByType: (...args: unknown[]) => mockGetBillersByType(...args),
}));

vi.mock('@/lib/supabase/client', () => ({
  calculateCommerce: mockCalculateCommerce,
}));

vi.mock('@/lib/monnify-bills', () => ({
  getCachedBillers: vi.fn().mockResolvedValue([]),
  getCachedBillerProducts: vi.fn().mockResolvedValue([]),
  getBillers: vi.fn().mockResolvedValue([]),
  getBillerProducts: vi.fn().mockResolvedValue([]),
  verifyBillCustomer: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const dstvBillers = [
  {
    billerId: 'dstv',
    billerName: 'DSTV',
    billerType: 'Cable',
    categoryId: 'cable',
    categoryName: 'CableTv',
    billItems: [
      {
        amount: 5000,
        isAmountFixed: true,
        itemCode: 'dstv-compact',
        itemCurrencySymbol: 'NGN',
        itemFee: 0,
        itemName: 'DStv Compact',
      },
    ],
  },
];

function prepareDstvCompact(
  supabase: ReturnType<typeof createMockSupabase>['supabase'],
  amount: number
) {
  return preparePendingVtuTransaction({
    supabase,
    user: {
      id: 'user-1',
      email_confirmed_at: '2026-01-01T00:00:00.000Z',
      email: 'customer@example.com',
    } as unknown as Parameters<typeof preparePendingVtuTransaction>[0]['user'],
    input: {
      merchantSlug: 'ogabassey',
      type: 'cable_tv',
      amount,
      billItemIdentifier: 'dstv-compact',
      customerIdentifier: '12345678',
      billerName: 'DSTV',
      provider: 'kuda',
      source: 'checkout',
    } as unknown as Parameters<typeof preparePendingVtuTransaction>[0]['input'],
    source: 'checkout',
  });
}

describe('preparePendingVtuTransaction Kuda bill price recheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearKudaBillItemPriceCacheForTests();
    mockGetBillersByType.mockResolvedValue(dstvBillers);
  });

  describe('bugfix: a saved 100x cable price could still be charged', () => {
    it('rejects a Kuda cable package sent at the old 100x price before charging', async () => {
      const { insert, supabase } = createMockSupabase();

      await expect(prepareDstvCompact(supabase, 500000)).rejects.toThrow(
        KUDA_BILL_PRICE_CHANGED_MESSAGE
      );
      expect(mockGetBillersByType).toHaveBeenCalledWith('CableTv');
      expect(insert).not.toHaveBeenCalled();
    });
  });

  it('prepares a Kuda cable package at its current price', async () => {
    const { insert, supabase } = createMockSupabase();

    await prepareDstvCompact(supabase, 5000);

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ provider: 'kuda' }),
      })
    );
  });
});

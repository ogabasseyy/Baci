import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadKudaBillers } from './biller-route-helpers';

const mockGetBillersByCategory = vi.fn();

vi.mock('@/lib/kuda-bills', () => ({
  getBillersByCategory: (...args: unknown[]) =>
    mockGetBillersByCategory(...args),
}));

vi.mock('@/lib/monnify-bills', () => ({
  getBillerProducts: vi.fn(),
  getBillers: vi.fn(),
}));

describe('loadKudaBillers server-only fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never sends the server-only price-check markers to clients', async () => {
    mockGetBillersByCategory.mockResolvedValue([
      {
        billItems: [
          {
            amount: 9500,
            isAmountFixed: true,
            itemCode: 'KUD-CAB-1',
            itemCurrencySymbol: 'NGN',
            itemFee: 0,
            itemName: 'Basic',
          },
        ],
        billerId: 'DSTV',
        billerName: 'DSTV',
        billerType: 'cable',
        categoryId: 'cable',
        categoryName: 'CableTv',
        packagesUnreadable: true,
        unreadableItemCodes: ['KUD-CAB-2'],
      },
    ]);

    const result = await loadKudaBillers('cable_tv');

    expect(result.billers).toHaveLength(1);
    expect(result.billers[0]).not.toHaveProperty('unreadableItemCodes');
    expect(result.billers[0]).not.toHaveProperty('packagesUnreadable');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { loadOrderGiglSettledRetainedAmount } from './load-order-gigl-settled-retained-amount';

describe('loadOrderGiglSettledRetainedAmount', () => {
  it('sums retained_shipping_amount from non-cancelled settlements', async () => {
    const eqSourceId = vi.fn().mockResolvedValue({
      data: [
        { metadata: { retained_shipping_amount: 1500 }, status: 'completed' },
        { metadata: { retained_shipping_amount: 1000 }, status: null },
        { metadata: { retained_shipping_amount: 9999 }, status: 'cancelled' },
      ],
      error: null,
    });
    const eqSourceType = vi.fn(() => ({ eq: eqSourceId }));
    const eqMerchant = vi.fn(() => ({ eq: eqSourceType }));
    const select = vi.fn(() => ({ eq: eqMerchant }));
    const from = vi.fn(() => ({ select }));

    await expect(
      loadOrderGiglSettledRetainedAmount(
        { from } as never,
        'merchant-1',
        'order-1'
      )
    ).resolves.toBe(2500);

    expect(from).toHaveBeenCalledWith('merchant_settlements');
    expect(select).toHaveBeenCalledWith('metadata, status');
    expect(eqMerchant).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(eqSourceType).toHaveBeenCalledWith('source_type', 'order');
    expect(eqSourceId).toHaveBeenCalledWith('source_id', 'order-1');
  });

  it('bugfix: float fragments still cover stamped retention totals in kobo', async () => {
    const eqSourceId = vi.fn().mockResolvedValue({
      data: [
        { metadata: { retained_shipping_amount: 1000 }, status: 'completed' },
        {
          metadata: { retained_shipping_amount: 1000.14 },
          status: 'completed',
        },
      ],
      error: null,
    });
    const from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ eq: eqSourceId })),
        })),
      })),
    }));

    await expect(
      loadOrderGiglSettledRetainedAmount(
        { from } as never,
        'merchant-1',
        'order-1'
      )
    ).resolves.toBe(2000.14);
  });

  it('bugfix: cancelled settlements do not reduce cumulative retention coverage', async () => {
    const eqSourceId = vi.fn().mockResolvedValue({
      data: [
        { metadata: { retained_shipping_amount: 2500 }, status: 'cancelled' },
        { metadata: { retained_shipping_amount: 2500 }, status: 'completed' },
      ],
      error: null,
    });
    const from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ eq: eqSourceId })),
        })),
      })),
    }));

    await expect(
      loadOrderGiglSettledRetainedAmount(
        { from } as never,
        'merchant-1',
        'order-1'
      )
    ).resolves.toBe(2500);
  });

  it('fails closed when the settlements query errors', async () => {
    const eqSourceId = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'permission denied' },
    });
    const from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ eq: eqSourceId })),
        })),
      })),
    }));

    await expect(
      loadOrderGiglSettledRetainedAmount(
        { from } as never,
        'merchant-1',
        'order-1'
      )
    ).rejects.toThrow('Failed to load settled GIGL retention');
  });
});

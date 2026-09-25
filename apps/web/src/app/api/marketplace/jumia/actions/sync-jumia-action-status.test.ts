import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateJumiaActionOrderStatus } from './sync-jumia-action-status';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

function jumiaUpdateChain(result: unknown) {
  return vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({ select: vi.fn().mockResolvedValue(result) })),
    })),
  }));
}

describe('updateJumiaActionOrderStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates both the cache row and the linked canonical order', async () => {
    const ordersUpdate = vi.fn(() => ({
      eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
    }));
    const from = vi.fn((table: string) =>
      table === 'jumia_orders'
        ? {
            update: jumiaUpdateChain({
              data: [{ baci_order_id: 'baci-1' }],
              error: null,
            }),
          }
        : { update: ordersUpdate }
    );

    const result = await updateJumiaActionOrderStatus(
      { from } as never,
      'jumia-1',
      'merchant-1',
      'ReadyToShip'
    );

    expect(result).toBeUndefined();
    expect(ordersUpdate).toHaveBeenCalledWith({ shipping_status: 'shipped' });
  });

  it('skips the canonical update when the cache row is unlinked', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'jumia_orders') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn().mockResolvedValue({
                  data: [{ baci_order_id: null }],
                  error: null,
                }),
              })),
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await updateJumiaActionOrderStatus(
      { from } as never,
      'jumia-1',
      'merchant-1',
      'Packed'
    );

    expect(result).toBeUndefined();
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('warns when the cache write fails without touching canonical orders', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'jumia_orders') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'cache offline' },
                }),
              })),
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await updateJumiaActionOrderStatus(
      { from } as never,
      'jumia-1',
      'merchant-1',
      'Cancelled'
    );

    expect(result).toEqual({
      syncWarning: 'Failed to update local DB',
      details: 'cache offline',
    });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('maps action outcomes and warns when the canonical write fails', async () => {
    const ordersUpdate = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: { message: 'orders offline' } }),
      })),
    }));
    const from = vi.fn((table: string) =>
      table === 'jumia_orders'
        ? {
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  select: vi.fn().mockResolvedValue({
                    data: [{ baci_order_id: 'baci-1' }],
                    error: null,
                  }),
                })),
              })),
            })),
          }
        : { update: ordersUpdate }
    );

    const result = await updateJumiaActionOrderStatus(
      { from } as never,
      'jumia-1',
      'merchant-1',
      'Cancelled'
    );

    expect(ordersUpdate).toHaveBeenCalledWith({
      shipping_status: 'cancelled',
    });
    expect(result).toEqual({
      syncWarning: 'Failed to update canonical order',
      details: 'orders offline',
    });
  });
});

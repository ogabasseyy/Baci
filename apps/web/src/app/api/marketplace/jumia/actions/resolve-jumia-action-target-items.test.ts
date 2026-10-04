import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetOrderItems = vi.hoisted(() => vi.fn());

vi.mock('@/lib/jumia/orders', () => ({
  getOrderItems: mockGetOrderItems,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

import type { JumiaClient } from '@/lib/jumia/client';
import { resolveJumiaActionTargetItems } from './resolve-jumia-action-target-items';

const client = {} as JumiaClient;

function orderWithItems(ids: string[]) {
  return { items: ids.map((id) => ({ id })) };
}

describe('resolveJumiaActionTargetItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports a partial subset as not all items', async () => {
    mockGetOrderItems.mockResolvedValue(orderWithItems(['ITEM-1', 'ITEM-2']));

    const result = await resolveJumiaActionTargetItems(client, 'order-1', [
      'ITEM-1',
    ]);

    expect(result).toEqual({ ok: true, isAllItems: false });
  });

  it('reports full coverage as all items', async () => {
    mockGetOrderItems.mockResolvedValue(orderWithItems(['ITEM-1', 'ITEM-2']));

    const result = await resolveJumiaActionTargetItems(client, 'order-1', [
      'ITEM-1',
      'ITEM-2',
    ]);

    expect(result).toEqual({ ok: true, isAllItems: true });
  });

  it('rejects item IDs from other orders', async () => {
    mockGetOrderItems.mockResolvedValue(orderWithItems(['ITEM-1']));

    const result = await resolveJumiaActionTargetItems(client, 'order-1', [
      'ITEM-1',
      'ITEM-OTHER-ORDER',
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      expect(await result.response.json()).toEqual({
        error: 'Some items do not belong to this order',
      });
    }
  });

  it('fails closed when ownership cannot be verified', async () => {
    mockGetOrderItems.mockRejectedValue(new Error('provider down'));

    const result = await resolveJumiaActionTargetItems(client, 'order-1', [
      'ITEM-1',
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(502);
      expect(await result.response.json()).toEqual({
        error: 'Unable to verify order items with Jumia. Try again.',
      });
    }
  });
});

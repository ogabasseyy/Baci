import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensurePaidOrderInventoryConfirmed,
  isSerializedInventoryUnavailableError,
} from '@/lib/payments/ensure-paid-order-inventory-confirmed';

const mockRevalidateProducts = vi.fn();
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
}));

interface MockSupabaseRpcClient {
  rpc: ReturnType<typeof vi.fn>;
}

function asSupabaseClient<T extends object>(client: T) {
  return client as Parameters<typeof ensurePaidOrderInventoryConfirmed>[0];
}

describe('ensurePaidOrderInventoryConfirmed', () => {
  beforeEach(() => {
    mockRevalidateProducts.mockReset();
  });

  it('succeeds without throwing when RPC returns no exception codes', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        alreadyConfirmed: 1,
        confirmedUnitCount: 0,
        reclaimedUnitCount: 0,
        missingUnitCount: 0,
        exceptionCodes: [],
      },
      error: null,
    });

    const mockSupabase: MockSupabaseRpcClient = {
      rpc: mockRpc,
    };

    await expect(
      ensurePaidOrderInventoryConfirmed(
        asSupabaseClient(mockSupabase),
        'merchant-123',
        'order-123'
      )
    ).resolves.not.toThrow();

    expect(mockRpc).toHaveBeenCalledWith(
      'confirm_order_inventory_reservations',
      {
        p_merchant_id: 'merchant-123',
        p_order_id: 'order-123',
      }
    );
    // reclaimedUnitCount 0 means confirmation left stock unchanged — no cache
    // churn needed on every no-op paid-order webhook.
    expect(mockRevalidateProducts).not.toHaveBeenCalled();
  });

  it('throws a database RPC error if the RPC call fails', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Database connection failed' },
    });

    const mockSupabase: MockSupabaseRpcClient = {
      rpc: mockRpc,
    };

    await expect(
      ensurePaidOrderInventoryConfirmed(
        asSupabaseClient(mockSupabase),
        'merchant-123',
        'order-123'
      )
    ).rejects.toThrow('Inventory confirmation failed');

    expect(mockRevalidateProducts).not.toHaveBeenCalled();
  });

  it('throws a custom error if exceptionCodes has elements', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        alreadyConfirmed: 0,
        confirmedUnitCount: 0,
        reclaimedUnitCount: 0,
        missingUnitCount: 1,
        exceptionCodes: [
          { itemId: 'item-123', code: 'late_payment_reservation_lost' },
        ],
      },
      error: null,
    });

    const mockSupabase: MockSupabaseRpcClient = {
      rpc: mockRpc,
    };

    await expect(
      ensurePaidOrderInventoryConfirmed(
        asSupabaseClient(mockSupabase),
        'merchant-123',
        'order-123'
      )
    ).rejects.toThrow('serialized_inventory_unavailable');

    try {
      await ensurePaidOrderInventoryConfirmed(
        asSupabaseClient(mockSupabase),
        'merchant-123',
        'order-123'
      );
    } catch (error) {
      expect(isSerializedInventoryUnavailableError(error)).toBe(true);
    }

    // No re-claim happened (reclaimedUnitCount: 0) — the exception is a
    // missing-unit failure, not a stock-changing re-claim.
    expect(mockRevalidateProducts).not.toHaveBeenCalled();
  });

  it('revalidates product caches when a reservation is re-claimed', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        alreadyConfirmed: 0,
        confirmedUnitCount: 0,
        reclaimedUnitCount: 1,
        missingUnitCount: 0,
        exceptionCodes: [],
      },
      error: null,
    });

    const mockSupabase: MockSupabaseRpcClient = { rpc: mockRpc };

    await ensurePaidOrderInventoryConfirmed(
      asSupabaseClient(mockSupabase),
      'merchant-123',
      'order-123'
    );

    expect(mockRevalidateProducts).toHaveBeenCalledExactlyOnceWith(
      'merchant-123'
    );
  });

  it('revalidates product caches AND still rejects when a re-claim is followed by an exception on a different item', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        alreadyConfirmed: 0,
        confirmedUnitCount: 0,
        reclaimedUnitCount: 1,
        missingUnitCount: 1,
        exceptionCodes: [
          { itemId: 'item-456', code: 'late_payment_reservation_lost' },
        ],
      },
      error: null,
    });

    const mockSupabase: MockSupabaseRpcClient = { rpc: mockRpc };

    // The re-claim already committed via the RPC even though a different
    // item's exception makes this call reject — caches must still be busted.
    await expect(
      ensurePaidOrderInventoryConfirmed(
        asSupabaseClient(mockSupabase),
        'merchant-123',
        'order-123'
      )
    ).rejects.toThrow('serialized_inventory_unavailable');

    expect(mockRevalidateProducts).toHaveBeenCalledExactlyOnceWith(
      'merchant-123'
    );
  });

  it('does not throw when revalidateProducts itself throws', async () => {
    mockRevalidateProducts.mockImplementationOnce(() => {
      throw new Error('revalidate boom');
    });
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        alreadyConfirmed: 0,
        confirmedUnitCount: 0,
        reclaimedUnitCount: 1,
        missingUnitCount: 0,
        exceptionCodes: [],
      },
      error: null,
    });

    const mockSupabase: MockSupabaseRpcClient = {
      rpc: mockRpc,
    };

    await expect(
      ensurePaidOrderInventoryConfirmed(
        asSupabaseClient(mockSupabase),
        'merchant-123',
        'order-123'
      )
    ).resolves.not.toThrow();
  });
});

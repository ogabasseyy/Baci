import { describe, expect, it, vi } from 'vitest';
import { rollbackOrderStatusAfterInventoryConfirmationFailure } from '@/lib/payments/ensure-paid-order-inventory-confirmed';

vi.mock('@/lib/cache-revalidation', () => ({ revalidateProducts: vi.fn() }));
vi.mock('@/lib/schedule-order-blog-purge-for-order-after-response', () => ({
  scheduleOrderBlogPurgeForOrderAfterResponse: vi.fn(),
}));

function asSupabaseClient<T extends object>(client: T) {
  return client as Parameters<
    typeof rollbackOrderStatusAfterInventoryConfirmationFailure
  >[0];
}

function createRollbackBuilder(result: {
  data: unknown;
  error: { message: string } | null;
}) {
  const builder: {
    eq: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
  } = {
    eq: vi.fn(() => builder),
    select: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

describe('rollbackOrderStatusAfterInventoryConfirmationFailure', () => {
  it('restores the prior order payment and shipping statuses', async () => {
    const rollbackBuilder = createRollbackBuilder({
      data: { id: 'order-123' },
      error: null,
    });
    const updateMock = vi.fn(() => rollbackBuilder);
    const supabase = { from: vi.fn(() => ({ update: updateMock })) };

    await rollbackOrderStatusAfterInventoryConfirmationFailure(
      asSupabaseClient(supabase),
      'merchant-123',
      'order-123',
      { payment_status: 'pending', shipping_status: 'pending' }
    );

    expect(supabase.from).toHaveBeenCalledWith('orders');
    expect(updateMock).toHaveBeenCalledWith({
      payment_status: 'pending',
      shipping_status: 'pending',
    });
    expect(rollbackBuilder.eq).toHaveBeenNthCalledWith(1, 'id', 'order-123');
    expect(rollbackBuilder.eq).toHaveBeenNthCalledWith(
      2,
      'merchant_id',
      'merchant-123'
    );
    expect(rollbackBuilder.select).toHaveBeenCalledWith('id');
    expect(rollbackBuilder.single).toHaveBeenCalledOnce();
  });

  it('restores amount_paid when the snapshot includes it', async () => {
    const rollbackBuilder = createRollbackBuilder({
      data: { id: 'order-123' },
      error: null,
    });
    const updateMock = vi.fn(() => rollbackBuilder);
    const supabase = { from: vi.fn(() => ({ update: updateMock })) };

    await rollbackOrderStatusAfterInventoryConfirmationFailure(
      asSupabaseClient(supabase),
      'merchant-123',
      'order-123',
      {
        payment_status: 'bnpl_pending',
        shipping_status: 'pending',
        amount_paid: 0,
      }
    );

    expect(updateMock).toHaveBeenCalledWith({
      payment_status: 'bnpl_pending',
      shipping_status: 'pending',
      amount_paid: 0,
    });
  });

  it('throws when the rollback update fails', async () => {
    const rollbackBuilder = createRollbackBuilder({
      data: null,
      error: { message: 'rollback failed' },
    });
    const supabase = {
      from: vi.fn(() => ({ update: vi.fn(() => rollbackBuilder) })),
    };

    await expect(
      rollbackOrderStatusAfterInventoryConfirmationFailure(
        asSupabaseClient(supabase),
        'merchant-123',
        'order-123',
        { payment_status: 'pending', shipping_status: 'pending' }
      )
    ).rejects.toThrow(
      'rollback_order_status_after_inventory_confirmation_failure failed: rollback failed'
    );
  });

  it('throws when no merchant-scoped order row is updated', async () => {
    const rollbackBuilder = createRollbackBuilder({
      data: null,
      error: {
        message: 'JSON object requested, multiple (or no) rows returned',
      },
    });
    const supabase = {
      from: vi.fn(() => ({ update: vi.fn(() => rollbackBuilder) })),
    };

    await expect(
      rollbackOrderStatusAfterInventoryConfirmationFailure(
        asSupabaseClient(supabase),
        'merchant-123',
        'order-123',
        { payment_status: 'pending', shipping_status: 'pending' }
      )
    ).rejects.toThrow(
      'rollback_order_status_after_inventory_confirmation_failure failed: JSON object requested, multiple (or no) rows returned'
    );
  });
});

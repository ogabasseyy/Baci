import { describe, expect, it, vi } from 'vitest';
import {
  type ensurePaidOrderInventoryConfirmed,
  rollbackOrderStatusAfterInventoryConfirmationFailure,
} from '@/lib/payments/ensure-paid-order-inventory-confirmed';

// Rollback scenarios, split from
// ensure-paid-order-inventory-confirmed.test.ts for the 300-line limit.
interface MockOrderRollbackClient {
  from: ReturnType<typeof vi.fn>;
}

function asSupabaseClient<T extends object>(client: T) {
  return client as Parameters<typeof ensurePaidOrderInventoryConfirmed>[0];
}

function createRollbackBuilder(error: { message: string } | null) {
  const builder: {
    eq: ReturnType<typeof vi.fn>;
    neq: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  } = {
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    select: vi.fn(() => builder),
    single: vi.fn(),
    maybeSingle: vi.fn(() =>
      Promise.resolve({ data: { id: 'order-123' }, error })
    ),
  };

  return builder;
}

function createRollbackMissingRowBuilder() {
  const builder: {
    eq: ReturnType<typeof vi.fn>;
    neq: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  } = {
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    select: vi.fn(() => builder),
    single: vi.fn(),
    maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
  };

  return builder;
}

describe('rollbackOrderStatusAfterInventoryConfirmationFailure', () => {
  it('restores the prior order payment and shipping statuses', async () => {
    const rollbackBuilder = createRollbackBuilder(null);
    const updateMock = vi.fn(() => rollbackBuilder);

    const mockSupabase: MockOrderRollbackClient = {
      from: vi.fn(() => ({ update: updateMock })),
    };

    await rollbackOrderStatusAfterInventoryConfirmationFailure(
      asSupabaseClient(mockSupabase),
      'merchant-123',
      'order-123',
      {
        payment_status: 'pending',
        shipping_status: 'pending',
      }
    );

    expect(mockSupabase.from).toHaveBeenCalledWith('orders');
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
    expect(rollbackBuilder.maybeSingle).toHaveBeenCalledOnce();
  });

  it('restores amount_paid when the snapshot includes it', async () => {
    const rollbackBuilder = createRollbackBuilder(null);
    const updateMock = vi.fn(() => rollbackBuilder);

    const mockSupabase: MockOrderRollbackClient = {
      from: vi.fn(() => ({ update: updateMock })),
    };

    await rollbackOrderStatusAfterInventoryConfirmationFailure(
      asSupabaseClient(mockSupabase),
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
      message: 'rollback failed',
    });
    const updateMock = vi.fn(() => rollbackBuilder);

    const mockSupabase: MockOrderRollbackClient = {
      from: vi.fn(() => ({ update: updateMock })),
    };

    await expect(
      rollbackOrderStatusAfterInventoryConfirmationFailure(
        asSupabaseClient(mockSupabase),
        'merchant-123',
        'order-123',
        {
          payment_status: 'pending',
          shipping_status: 'pending',
        }
      )
    ).rejects.toThrow(
      'rollback_order_status_after_inventory_confirmation_failure failed: rollback failed'
    );
  });

  it('resolves silently when no merchant-scoped order row matches', async () => {
    const rollbackBuilder = createRollbackMissingRowBuilder();
    const updateMock = vi.fn(() => rollbackBuilder);

    const mockSupabase: MockOrderRollbackClient = {
      from: vi.fn(() => ({ update: updateMock })),
    };

    // The unconditional cancellation fence makes a vanished, moved, or
    // cancelled row a silent skip instead of a failure.
    await expect(
      rollbackOrderStatusAfterInventoryConfirmationFailure(
        asSupabaseClient(mockSupabase),
        'merchant-123',
        'order-123',
        {
          payment_status: 'pending',
          shipping_status: 'pending',
        }
      )
    ).resolves.toBeUndefined();
  });

  it('fences the restore to the guarded current statuses', async () => {
    const inMock = vi.fn();
    const maybeSingleMock = vi
      .fn()
      .mockResolvedValue({ data: { id: 'order-123' }, error: null });
    const builder = {
      eq: vi.fn(function (this: unknown) {
        return this;
      }),
      neq: vi.fn(function (this: unknown) {
        return this;
      }),
      in: inMock,
      select: vi.fn(function (this: unknown) {
        return this;
      }),
      single: vi.fn(),
      maybeSingle: maybeSingleMock,
    };
    inMock.mockReturnValue(builder);
    const updateMock = vi.fn(() => builder);
    const mockSupabase: MockOrderRollbackClient = {
      from: vi.fn(() => ({ update: updateMock })),
    };

    await rollbackOrderStatusAfterInventoryConfirmationFailure(
      asSupabaseClient(mockSupabase),
      'merchant-123',
      'order-123',
      {
        payment_status: 'pending',
        shipping_status: 'pending',
      },
      { onlyIfPaymentStatus: ['bnpl_approved'] }
    );

    expect(inMock).toHaveBeenCalledWith('payment_status', ['bnpl_approved']);
    expect(maybeSingleMock).toHaveBeenCalledOnce();
  });

  it('resolves silently when the fenced row already moved on', async () => {
    const builder = {
      eq: vi.fn(function (this: unknown) {
        return this;
      }),
      neq: vi.fn(function (this: unknown) {
        return this;
      }),
      in: vi.fn(function (this: unknown) {
        return this;
      }),
      select: vi.fn(function (this: unknown) {
        return this;
      }),
      single: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const updateMock = vi.fn(() => builder);
    const mockSupabase: MockOrderRollbackClient = {
      from: vi.fn(() => ({ update: updateMock })),
    };

    // A concurrent writer settled the order past the guarded state:
    // zero matching rows is a skip, not a failure.
    await expect(
      rollbackOrderStatusAfterInventoryConfirmationFailure(
        asSupabaseClient(mockSupabase),
        'merchant-123',
        'order-123',
        {
          payment_status: 'pending',
          shipping_status: 'pending',
        },
        { onlyIfPaymentStatus: ['bnpl_approved'] }
      )
    ).resolves.toBeUndefined();
  });
});

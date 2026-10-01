import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  getOrderStatus,
  hasActivePaystackOrderDvaAlias,
  isActiveOrderDvaAlias,
} from './paystack-dva-order-alias';

const createdAt = '2026-05-22T10:00:00.000Z';

function orderAliasRow(overrides: Record<string, unknown> = {}) {
  return {
    account_number: '1234567890',
    created_at: createdAt,
    expires_at: '2026-05-22T11:45:00.000Z',
    orders: { id: 'order-1', payment_status: 'unpaid' },
    ...overrides,
  };
}

function createSupabaseResult({
  data,
  error,
}: {
  data?: unknown[];
  error?: { message: string } | null;
}) {
  const eqAccount = vi.fn().mockResolvedValue({ data: data ?? [], error });
  const eqProvider = vi.fn(() => ({ eq: eqAccount }));
  const select = vi.fn(() => ({ eq: eqProvider }));
  return {
    eqAccount,
    from: vi.fn(() => ({ select })),
  };
}

describe('paystack DVA order alias helpers', () => {
  it('reads order status from object or joined-array rows', () => {
    expect(getOrderStatus(orderAliasRow())).toBe('unpaid');
    expect(
      getOrderStatus(
        orderAliasRow({
          orders: [{ id: 'order-1', payment_status: 'pending' }],
        })
      )
    ).toBe('pending');
    expect(getOrderStatus(orderAliasRow({ orders: null }))).toBeNull();
  });

  it('treats unpaid, pending, and partially-paid aliases inside the 90-minute window as active', () => {
    expect(
      isActiveOrderDvaAlias(
        orderAliasRow(),
        new Date('2026-05-22T11:30:00.000Z')
      )
    ).toBe(true);
    expect(
      isActiveOrderDvaAlias(
        orderAliasRow({ orders: { payment_status: 'pending' } }),
        new Date('2026-05-22T11:30:00.000Z')
      )
    ).toBe(true);
    expect(
      isActiveOrderDvaAlias(
        orderAliasRow({ orders: { payment_status: 'partially_paid' } }),
        new Date('2026-05-22T11:30:00.000Z')
      )
    ).toBe(true);
  });

  it('keeps the exact 90-minute boundary active', () => {
    expect(
      isActiveOrderDvaAlias(
        orderAliasRow({ expires_at: null }),
        new Date('2026-05-22T11:30:00.000Z')
      )
    ).toBe(true);
  });

  it('anchors a refreshed partially-paid alias window to assigned_at', () => {
    const alias = orderAliasRow({
      assigned_at: '2026-05-22T11:00:00.000Z',
      expires_at: '2026-05-22T12:30:00.000Z',
      orders: { payment_status: 'partially_paid' },
    });

    const isActive = isActiveOrderDvaAlias(
      alias,
      new Date('2026-05-22T12:00:00.000Z')
    );

    expect(isActive).toBe(true);
  });

  it('honors an explicit invoice expiry beyond the default wallet window', () => {
    const alias = orderAliasRow({
      assigned_at: '2026-05-22T10:00:00.000Z',
      expires_at: '2026-05-22T12:00:00.000Z',
    });

    expect(
      isActiveOrderDvaAlias(alias, new Date('2026-05-22T11:45:00.000Z'))
    ).toBe(true);
  });

  it('treats expired, malformed, and paid aliases as inactive', () => {
    const asOf = new Date('2026-05-22T10:30:00.000Z');

    expect(
      isActiveOrderDvaAlias(
        orderAliasRow({ expires_at: '2026-05-22T10:15:00.000Z' }),
        asOf
      )
    ).toBe(false);
    expect(
      isActiveOrderDvaAlias(orderAliasRow({ created_at: null }), asOf)
    ).toBe(false);
    expect(
      isActiveOrderDvaAlias(orderAliasRow({ created_at: 'not-a-date' }), asOf)
    ).toBe(false);
    expect(
      isActiveOrderDvaAlias(
        orderAliasRow({ orders: { payment_status: 'paid' } }),
        asOf
      )
    ).toBe(false);
  });

  it('treats a cancelled order alias as inactive even when unpaid and in-window', () => {
    expect(
      isActiveOrderDvaAlias(
        orderAliasRow({
          orders: { payment_status: 'unpaid', shipping_status: 'cancelled' },
        }),
        new Date('2026-05-22T11:30:00.000Z')
      )
    ).toBe(false);
  });

  it('treats a canceled order alias as inactive even when unpaid and in-window', () => {
    expect(
      isActiveOrderDvaAlias(
        orderAliasRow({
          orders: {
            payment_status: 'unpaid',
            shipping_status: 'canceled',
          },
        }),
        new Date('2026-05-22T11:30:00.000Z')
      )
    ).toBe(false);
  });

  it('treats a legacy-untrusted alias as inactive even when in-window', () => {
    expect(
      isActiveOrderDvaAlias(
        orderAliasRow({
          assignment_customer_email_source: 'legacy_untrusted',
        }),
        new Date('2026-05-22T10:30:00.000Z')
      )
    ).toBe(false);
  });

  it('ignores a cancelled order alias when scanning Supabase rows', async () => {
    const cancelledSupabase = createSupabaseResult({
      data: [
        orderAliasRow({
          orders: { payment_status: 'unpaid', shipping_status: 'cancelled' },
        }),
      ],
      error: null,
    });

    await expect(
      hasActivePaystackOrderDvaAlias({
        accountNumber: '1234567890',
        asOf: new Date('2026-05-22T10:30:00.000Z'),
        supabase: cancelledSupabase as unknown as SupabaseClient,
      })
    ).resolves.toBe(false);
  });

  it('detects active aliases from Supabase rows', async () => {
    const supabase = createSupabaseResult({
      data: [orderAliasRow()],
      error: null,
    });

    await expect(
      hasActivePaystackOrderDvaAlias({
        accountNumber: '1234567890',
        asOf: new Date('2026-05-22T10:30:00.000Z'),
        supabase: supabase as unknown as SupabaseClient,
      })
    ).resolves.toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('order_payment_accounts');
  });

  it('returns false for inactive rows and throws Supabase errors', async () => {
    const inactiveSupabase = createSupabaseResult({
      data: [orderAliasRow({ orders: { payment_status: 'paid' } })],
      error: null,
    });
    await expect(
      hasActivePaystackOrderDvaAlias({
        accountNumber: '1234567890',
        asOf: new Date('2026-05-22T10:30:00.000Z'),
        supabase: inactiveSupabase as unknown as SupabaseClient,
      })
    ).resolves.toBe(false);

    const failingSupabase = createSupabaseResult({
      error: { message: 'database unavailable' },
    });
    await expect(
      hasActivePaystackOrderDvaAlias({
        accountNumber: '1234567890',
        asOf: new Date('2026-05-22T10:30:00.000Z'),
        supabase: failingSupabase as unknown as SupabaseClient,
      })
    ).rejects.toEqual({ message: 'database unavailable' });
  });
});

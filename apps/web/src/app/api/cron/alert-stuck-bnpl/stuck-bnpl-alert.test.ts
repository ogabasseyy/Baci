import { describe, expect, it } from 'vitest';
import {
  buildStuckBnplAlert,
  type StuckBnplOrderRow,
} from './stuck-bnpl-alert';

const NOW = new Date('2026-07-04T08:00:00.000Z');

function order(overrides: Partial<StuckBnplOrderRow> = {}): StuckBnplOrderRow {
  return {
    id: 'order-1-abcdef',
    order_number: 'ORD-1',
    merchant_id: 'merchant-1',
    total: 100000,
    payment_method: 'credit_direct',
    payment_status: 'bnpl_pending',
    updated_at: '2026-07-03T00:00:00.000Z',
    notes: '{"credit_directTransactionId":"txn-1"}',
    ...overrides,
  };
}

describe('buildStuckBnplAlert', () => {
  it('names the order, provider and action for a single order', () => {
    const alert = buildStuckBnplAlert([order()], NOW);

    expect(alert.title).toBe('⚠️ BNPL payment to confirm');
    expect(alert.body).toBe(
      'Order #ORD-1 (₦100,000) went through Credit Direct checkout over a day ago, but the payment is not confirmed yet. Check with Credit Direct before you fulfil it.'
    );
    expect(alert.data).toEqual({
      type: 'stuck_bnpl_alert',
      stuck_order_count: 1,
      total_amount: 100000,
      oldest_order_id: 'order-1-abcdef',
      order_id: 'order-1-abcdef',
    });
  });

  it('labels canonical provider names regardless of stored formatting', () => {
    const alert = buildStuckBnplAlert(
      [order({ payment_method: ' Credit_Direct ' })],
      NOW
    );
    expect(alert.body).toContain('Check with Credit Direct');
  });

  it('summarises several orders and leaves out the single-order link', () => {
    const alert = buildStuckBnplAlert(
      [
        order({ id: 'order-2', order_number: 'ORD-2', total: '50000.5' }),
        order({ updated_at: '2026-07-01T00:00:00.000Z' }),
      ],
      NOW
    );

    expect(alert.title).toBe('⚠️ 2 BNPL payments to confirm');
    expect(alert.body).toContain('2 orders totalling ₦150,000.5');
    expect(alert.body).toContain('Oldest: #ORD-1 (3 days)');
    expect(alert.data).not.toHaveProperty('order_id');
  });

  it('uses a generic provider name when providers are mixed or unknown', () => {
    const mixed = buildStuckBnplAlert(
      [order(), order({ id: 'order-2', payment_method: 'klump' })],
      NOW
    );
    const unknown = buildStuckBnplAlert(
      [order({ payment_method: 'other' })],
      NOW
    );

    expect(mixed.body).toContain('Check with the BNPL provider');
    expect(unknown.body).toContain('Check with the BNPL provider');
  });

  it('falls back to a short id when the order has no number', () => {
    const alert = buildStuckBnplAlert([order({ order_number: null })], NOW);

    expect(alert.body).toContain('Order #order-1-');
  });

  it.each([
    ['2026-07-01T07:00:00.000Z', 3],
    ['2026-07-05T00:00:00.000Z', 0],
    ['not-a-date', 0],
  ])('reports the age of %s as %s days', (updated_at, days) => {
    expect(
      buildStuckBnplAlert([order({ updated_at })], NOW).oldestAgeDays
    ).toBe(days);
  });

  it('rejects an empty order list', () => {
    expect(() => buildStuckBnplAlert([], NOW)).toThrow(
      'buildStuckBnplAlert needs at least one order'
    );
  });
});

import { describe, expect, it } from 'vitest';
import { formatOrderPlacedDate } from './format-order-placed-date';

const historicalOrder = {
  created_at: '2026-11-12T10:00:00.000Z',
  transaction_date: '2023-03-13T23:00:00.000Z',
};

describe('formatOrderPlacedDate', () => {
  it('uses the historical sale instant on March 14 in Lagos, not its November recording', () => {
    expect(formatOrderPlacedDate(historicalOrder, 'NG')).toBe(
      '14 Mar 2023, 00:00'
    );
    expect(formatOrderPlacedDate(historicalOrder, 'Nigeria')).toBe(
      '14 Mar 2023, 00:00'
    );
  });

  it.each([
    ['GB', '13 Mar 2023, 23:00'],
    ['US', '13 Mar 2023, 19:00'],
    ['JP', '14 Mar 2023, 08:00'],
  ])('uses the existing merchant timezone for %s rather than Lagos', (country, expected) => {
    expect(formatOrderPlacedDate(historicalOrder, country)).toBe(expected);
  });

  it('applies daylight saving in the merchant timezone', () => {
    expect(
      formatOrderPlacedDate(
        { ...historicalOrder, transaction_date: '2023-07-13T23:00:00.000Z' },
        'GB'
      )
    ).toBe('14 Jul 2023, 00:00');
  });

  it.each([
    null,
    undefined,
    '',
    'not-a-date',
  ])('falls back safely for transaction_date=%s', (transaction_date) => {
    expect(
      formatOrderPlacedDate({ ...historicalOrder, transaction_date }, 'NG')
    ).toBe('12 Nov 2026, 11:00');
  });

  it('keeps the sale timestamp when the recording date is invalid', () => {
    expect(
      formatOrderPlacedDate({ ...historicalOrder, created_at: 'invalid' }, 'NG')
    ).toBe('14 Mar 2023, 00:00');
  });

  it('returns a dash when neither timestamp is usable', () => {
    expect(
      formatOrderPlacedDate(
        { created_at: 'invalid', transaction_date: null },
        'NG'
      )
    ).toBe('-');
  });

  it('retains device-local formatting when the merchant country is unknown', () => {
    const expected = new Date(historicalOrder.transaction_date).toLocaleString(
      'en-NG',
      {
        dateStyle: 'medium',
        timeStyle: 'short',
      }
    );
    expect(formatOrderPlacedDate(historicalOrder, 'unknown')).toBe(expected);
    expect(formatOrderPlacedDate(historicalOrder)).toBe(expected);
  });

  it('does not change creation, update, or payment history fields', () => {
    const order = Object.freeze({
      ...historicalOrder,
      updated_at: '2026-11-13T10:00:00.000Z',
      transactions: Object.freeze([{ created_at: '2026-11-12T11:00:00.000Z' }]),
    });
    const original = structuredClone(order);
    formatOrderPlacedDate(order, 'NG');
    expect(order).toEqual(original);
  });
});

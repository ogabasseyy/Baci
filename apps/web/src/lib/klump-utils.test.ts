import { describe, expect, it } from 'vitest';
import {
  buildKlumpItems,
  getBnplRemainingAmount,
  getUnmaskedValue,
  normalizeKlumpPhone,
  toCurrencyAmount,
  toKlumpIntegerAmount,
} from '@/lib/klump-utils';

describe('klump-utils', () => {
  it('normalizes Nigerian phone numbers for Klump', () => {
    expect(normalizeKlumpPhone('+234 801 234 5678')).toBe('08012345678');
    expect(normalizeKlumpPhone('8012345678')).toBe('08012345678');
  });

  it('prefers unmasked customer values', () => {
    expect(getUnmaskedValue('cu***@example.com', 'buyer@example.com')).toBe(
      'buyer@example.com'
    );
  });

  it('normalizes currency amounts to positive two-decimal values', () => {
    expect(toCurrencyAmount('58088.555')).toBe(58088.56);
    expect(toCurrencyAmount('invalid')).toBe(0);
  });

  it('normalizes Klump amounts to positive integers', () => {
    expect(toKlumpIntegerAmount('58088')).toBe(58088);
    expect(toKlumpIntegerAmount('58088.49')).toBe(58089);
    expect(toKlumpIntegerAmount('58088.5')).toBe(58089);
    expect(toKlumpIntegerAmount('invalid')).toBe(0);
    expect(toKlumpIntegerAmount('0')).toBe(0);
    expect(toKlumpIntegerAmount('-123')).toBe(0);
    expect(toKlumpIntegerAmount('')).toBe(0);
    expect(toKlumpIntegerAmount(null)).toBe(0);
    expect(toKlumpIntegerAmount(undefined)).toBe(0);
  });

  it('balances Klump items to the rounded order total with integer prices', () => {
    expect(
      buildKlumpItems({
        id: 'order-1',
        total: 58_088.5,
        shipping_cost: 2726,
        items: [
          {
            name: 'Capsule',
            price: 51_500,
            quantity: 1,
          },
        ],
      })
    ).toEqual([
      { name: 'Capsule', quantity: 1, unit_price: 51_500 },
      { name: 'Delivery', quantity: 1, unit_price: 2726 },
      { name: 'Taxes and fees', quantity: 1, unit_price: 3863 },
    ]);
  });

  it('collapses fractional multi-quantity lines when needed to keep Klump prices integer', () => {
    expect(
      buildKlumpItems({
        id: 'order-1',
        total: 100.98,
        items: [
          {
            name: 'Installment item',
            price: 33.66,
            quantity: 3,
          },
        ],
      })
    ).toEqual([{ name: 'Installment item', quantity: 1, unit_price: 101 }]);
  });

  it('keeps rounded Klump items from exceeding the charged amount', () => {
    expect(
      buildKlumpItems({
        id: 'order-1',
        total: 101,
        items: [
          {
            name: 'First item',
            price: 50.6,
            quantity: 1,
          },
          {
            name: 'Second item',
            price: 50.6,
            quantity: 1,
          },
        ],
      })
    ).toEqual([
      { name: 'First item', quantity: 1, unit_price: 51 },
      { name: 'Second item', quantity: 1, unit_price: 50 },
    ]);
  });

  it('omits zero-value rounded lines and uses the final adjustment for the payable amount', () => {
    expect(
      buildKlumpItems({
        id: 'order-1',
        total: 1,
        items: [
          {
            name: 'Tiny item',
            price: 0,
            quantity: 1,
          },
        ],
      })
    ).toEqual([{ name: 'Taxes and fees', quantity: 1, unit_price: 1 }]);
  });

  it('rounds positive fractional Klump item prices up to the payable amount', () => {
    expect(
      buildKlumpItems({
        id: 'order-1',
        total: 1,
        items: [
          {
            name: 'Fractional item',
            price: 0.4,
            quantity: 1,
          },
        ],
      })
    ).toEqual([{ name: 'Fractional item', quantity: 1, unit_price: 1 }]);
  });

  it('drops rounded one-naira lines when they would exceed the Klump amount', () => {
    expect(
      buildKlumpItems({
        id: 'order-1',
        total: 1,
        items: [
          {
            name: 'First tiny item',
            price: 0.6,
            quantity: 1,
          },
          {
            name: 'Second tiny item',
            price: 0.6,
            quantity: 1,
          },
        ],
      })
    ).toEqual([{ name: 'First tiny item', quantity: 1, unit_price: 1 }]);
  });

  it('computes net remaining payable amount and balances Klump items to it when pre-gateway credit was applied', () => {
    expect(
      getBnplRemainingAmount({
        total: 50_000,
        amount_paid: 15_000,
        wallet_amount_used: 15_000,
      })
    ).toBe(35_000);

    expect(
      buildKlumpItems({
        id: 'order-1',
        total: 50_000,
        amount_paid: 15_000,
        items: [{ name: 'Phone', price: 50_000, quantity: 1 }],
      })
    ).toEqual([{ name: 'Phone', quantity: 1, unit_price: 35_000 }]);

    expect(
      getBnplRemainingAmount({
        total: 50_000,
        amount_paid: 0,
        wallet_amount_used: 0,
        wallet_ledger_used: 10_000,
        savings_ledger_used: 5_000,
      })
    ).toBe(35_000);

    expect(
      getBnplRemainingAmount({
        total: 50_000,
        payment_status: 'pending',
        amount_paid: 15_000,
        wallet_amount_used: 0,
      })
    ).toBe(35_000);

    expect(
      getBnplRemainingAmount({
        total: 50_000,
        payment_status: 'unpaid',
        amount_paid: 20_000,
        wallet_amount_used: 20_000,
        wallet_ledger_used: 0,
        savings_ledger_used: 5_000,
        wallet_reversal_completed: true,
      })
    ).toBe(45_000);

    expect(
      getBnplRemainingAmount({
        total: 50_000,
        payment_status: 'partially_paid',
        amount_paid: 15_000,
        wallet_amount_used: 0,
        wallet_ledger_used: null,
        savings_ledger_used: null,
      })
    ).toBe(35_000);

    expect(
      getBnplRemainingAmount({
        total: 50_000,
        payment_status: 'partially_paid',
        amount_paid: 30_000,
        wallet_amount_used: 10_000,
        wallet_ledger_used: 10_000,
        savings_ledger_used: 5_000,
      })
    ).toBe(20_000);

    expect(
      getBnplRemainingAmount({
        total: 50_000,
        payment_status: 'partially_paid',
        amount_paid: 40_000,
        wallet_amount_used: 20_000,
        wallet_ledger_used: 0,
        savings_ledger_used: 0,
        wallet_reversal_completed: true,
        wallet_reversed_credit: 20_000,
      })
    ).toBe(30_000);

    expect(
      getBnplRemainingAmount({
        total: 50_000,
        payment_status: 'partially_paid',
        amount_paid: 40_000,
        wallet_amount_used: 20_000,
        wallet_reversal_completed: true,
        wallet_reversed_credit: 20_000,
      })
    ).toBe(30_000);

    expect(
      getBnplRemainingAmount({
        total: 50_000,
        payment_status: 'bnpl_approved',
        amount_paid: 35_000,
        wallet_amount_used: 15_000,
        wallet_ledger_used: 15_000,
        savings_ledger_used: 0,
      })
    ).toBe(0);

    expect(
      getBnplRemainingAmount({
        total: 50_000,
        payment_status: 'bnpl_approved',
        amount_paid: 35_000,
        wallet_amount_used: 15_000,
      })
    ).toBe(0);

    expect(
      getBnplRemainingAmount({
        total: 50_000,
        payment_status: 'paid',
        amount_paid: 50_000,
        wallet_ledger_used: 0,
        savings_ledger_used: 0,
      })
    ).toBe(0);
  });
});

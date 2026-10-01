import { describe, expect, it } from 'vitest';
import {
  buildImmediateInvoiceShippingAddress,
  getImmediateInvoiceDueDate,
  getImmediateInvoiceIssueDate,
  getOptionalString,
  getOrderItemBaseName,
  getOrderItemCondition,
  getOrderItemProductId,
  getOrderItemUnitPrice,
  getStringRecord,
  roundCurrency,
  toFiniteNumber,
} from './order-item-primitives';

describe('order-item-primitives', () => {
  it('resolves product identity with legacy fallbacks', () => {
    expect(getOrderItemProductId({ product_id: 'p1' } as never)).toBe('p1');
    expect(getOrderItemProductId({ productId: 'p2' } as never)).toBe('p2');
    expect(getOrderItemProductId({ id: 'p3' } as never)).toBe('p3');
  });

  it('falls back naming and condition to neutral defaults', () => {
    expect(getOrderItemBaseName({})).toBe('Product');
    expect(getOrderItemBaseName({ productName: 'Phone' })).toBe('Phone');
    expect(getOrderItemCondition({})).toBeNull();
    expect(getOrderItemCondition({ condition: 'new' })).toBe('new');
  });

  it('prefers the negotiated unit price', () => {
    expect(
      getOrderItemUnitPrice({ price: 5000, negotiatedPrice: 4500 } as never)
    ).toBe(4500);
    expect(getOrderItemUnitPrice({ price: 5000 } as never)).toBe(5000);
  });

  it('coerces numbers and strings safely', () => {
    expect(toFiniteNumber('12.5')).toBe(12.5);
    expect(toFiniteNumber('nope')).toBeNull();
    expect(roundCurrency(10.005)).toBe(10.01);
    expect(getOptionalString('  ')).toBeUndefined();
    expect(getOptionalString(' x ')).toBe('x');
    expect(getStringRecord({ a: 'x', b: 1 })).toEqual({ a: 'x' });
    expect(getStringRecord([])).toBeUndefined();
  });

  it('builds invoice addresses and due dates', () => {
    expect(buildImmediateInvoiceShippingAddress(null as never)).toBeNull();
    expect(
      buildImmediateInvoiceShippingAddress({
        address: '12 Market St',
        city: 'Lagos',
        state: 'Lagos',
        postalCode: '100001',
      } as never)
    ).toMatchObject({ city: 'Lagos', country: 'NG' });
    expect(
      getImmediateInvoiceIssueDate({
        created_at: '2026-01-01T00:00:00.000Z',
      }).toISOString()
    ).toBe('2026-01-01T00:00:00.000Z');
    expect(
      getImmediateInvoiceDueDate({
        created_at: '2026-01-01T00:00:00.000Z',
      }).toISOString()
    ).toBe('2026-01-15T00:00:00.000Z');
  });
});

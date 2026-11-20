import { beforeEach, describe, expect, it } from 'vitest';
import {
  getChatwootCheckoutRememberedOrder,
  getChatwootCheckoutRememberedOrderByReference,
  isChatwootCheckoutIssuedReference,
  rememberChatwootCheckoutOrder,
  rememberChatwootCheckoutPayment,
  resetChatwootCheckoutOrderMemory,
  simulateChatwootCheckoutReload,
} from './chatwoot-checkout-memory';

const order = (orderNumber: string) => ({
  orderId: `id-${orderNumber}`,
  orderNumber,
  trackingToken: null,
  amountDueMajor: 1000,
  currency: 'NGN',
});
const payment = (reference: string) => ({
  bank: {
    bankName: 'Test Bank',
    accountNumber: '0123456789',
    accountName: 'Test Store',
  },
  reference,
});

beforeEach(() => resetChatwootCheckoutOrderMemory());

describe('chat checkout order memory', () => {
  it('remembers an order with its merchant and no payment until one is issued', () => {
    rememberChatwootCheckoutOrder('key-1', 'merchant-1', order('ORD-1'));

    expect(getChatwootCheckoutRememberedOrder('key-1')).toEqual({
      merchantId: 'merchant-1',
      order: order('ORD-1'),
      payment: null,
    });
    expect(getChatwootCheckoutRememberedOrder('unknown')).toBeNull();
  });

  it('treats only references issued for a remembered order as pollable', () => {
    rememberChatwootCheckoutOrder('key-1', 'merchant-1', order('ORD-1'));
    expect(isChatwootCheckoutIssuedReference('ref-1')).toBe(false);

    rememberChatwootCheckoutPayment('key-1', payment('ref-1'));

    expect(isChatwootCheckoutIssuedReference('ref-1')).toBe(true);
    expect(isChatwootCheckoutIssuedReference('ref-2')).toBe(false);
    expect(getChatwootCheckoutRememberedOrder('key-1')?.payment).toEqual({
      ...payment('ref-1'),
      issuedAt: expect.any(Number),
    });
    expect(
      getChatwootCheckoutRememberedOrderByReference('ref-1')?.order.orderId
    ).toBe('id-ORD-1');
    expect(getChatwootCheckoutRememberedOrderByReference('ref-2')).toBeNull();
  });

  it('ignores a payment for an order it does not remember', () => {
    rememberChatwootCheckoutPayment('never-created', payment('ref-9'));

    expect(isChatwootCheckoutIssuedReference('ref-9')).toBe(false);
  });

  it('forgets the oldest order, and its reference, past the bound', () => {
    rememberChatwootCheckoutOrder('key-0', 'merchant-1', order('ORD-0'));
    rememberChatwootCheckoutPayment('key-0', payment('ref-0'));
    for (let index = 1; index <= 20; index += 1) {
      rememberChatwootCheckoutOrder(
        `key-${index}`,
        'merchant-1',
        order(`ORD-${index}`)
      );
    }

    expect(getChatwootCheckoutRememberedOrder('key-0')).toBeNull();
    expect(isChatwootCheckoutIssuedReference('ref-0')).toBe(false);
    expect(getChatwootCheckoutRememberedOrder('key-20')).not.toBeNull();
  });

  it('keeps orders and issued bank details across a page reload', () => {
    rememberChatwootCheckoutOrder('key-1', 'merchant-1', order('ORD-1'));
    rememberChatwootCheckoutPayment('key-1', payment('ref-1'));

    simulateChatwootCheckoutReload();

    expect(getChatwootCheckoutRememberedOrder('key-1')).toEqual({
      merchantId: 'merchant-1',
      order: order('ORD-1'),
      payment: { ...payment('ref-1'), issuedAt: expect.any(Number) },
    });
    expect(isChatwootCheckoutIssuedReference('ref-1')).toBe(true);
  });

  it('ignores stored data that does not match the expected shape', () => {
    window.sessionStorage.setItem(
      'baci-chat-checkout-orders:v1',
      JSON.stringify([['key-1', { merchantId: 'merchant-1', extra: true }]])
    );
    simulateChatwootCheckoutReload();

    expect(getChatwootCheckoutRememberedOrder('key-1')).toBeNull();
  });

  it('stores no contact or address details', () => {
    rememberChatwootCheckoutOrder('key-1', 'merchant-1', order('ORD-1'));
    rememberChatwootCheckoutPayment('key-1', payment('ref-1'));

    const stored =
      window.sessionStorage.getItem('baci-chat-checkout-orders:v1') ?? '';
    expect(stored).toContain('ORD-1');
    expect(stored).not.toMatch(/email|phone|address|firstName|lastName/i);
  });
});

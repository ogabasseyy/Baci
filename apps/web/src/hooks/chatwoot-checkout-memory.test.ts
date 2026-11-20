import { beforeEach, describe, expect, it } from 'vitest';
import {
  getChatwootCheckoutRememberedOrder,
  isChatwootCheckoutIssuedReference,
  rememberChatwootCheckoutOrder,
  rememberChatwootCheckoutPayment,
  resetChatwootCheckoutOrderMemory,
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
    expect(getChatwootCheckoutRememberedOrder('key-1')?.payment).toEqual(
      payment('ref-1')
    );
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
});

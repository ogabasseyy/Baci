import { describe, expect, it } from 'vitest';
import {
  getVtuProviderLabel,
  readPaymentSplit,
} from './vtu-payment-split';

describe('readPaymentSplit', () => {
  it('reads a well-formed wallet/card split', () => {
    expect(
      readPaymentSplit({ paymentSplit: { card: 400, wallet: 600 } })
    ).toEqual({ card: 400, wallet: 600 });
  });

  it('returns null when metadata or the split is absent', () => {
    expect(readPaymentSplit(null)).toBeNull();
    expect(readPaymentSplit(undefined)).toBeNull();
    expect(readPaymentSplit({})).toBeNull();
    expect(readPaymentSplit({ paymentSplit: null })).toBeNull();
  });

  it('returns null when either leg is not a number', () => {
    expect(
      readPaymentSplit({ paymentSplit: { card: 400, wallet: '600' } })
    ).toBeNull();
    expect(readPaymentSplit({ paymentSplit: { wallet: 600 } })).toBeNull();
    expect(readPaymentSplit({ paymentSplit: { card: 0 } })).toBeNull();
  });

  it('ignores extra keys on the split object', () => {
    expect(
      readPaymentSplit({
        paymentSplit: { card: 0, extra: 'x', wallet: 1000 },
      })
    ).toEqual({ card: 0, wallet: 1000 });
  });
});

describe('getVtuProviderLabel', () => {
  it('prefers the network provider, then the biller name', () => {
    expect(
      getVtuProviderLabel({
        biller_name: 'Ikeja Electric',
        network_provider: 'mtn',
        type: 'airtime',
      })
    ).toBe('mtn');
    expect(
      getVtuProviderLabel({
        biller_name: 'Ikeja Electric',
        network_provider: null,
        type: 'electricity',
      })
    ).toBe('Ikeja Electric');
  });

  it('falls back to the type label when no provider is set', () => {
    expect(
      getVtuProviderLabel({
        biller_name: null,
        network_provider: null,
        type: 'airtime',
      })
    ).toBe('Airtime');
  });
});

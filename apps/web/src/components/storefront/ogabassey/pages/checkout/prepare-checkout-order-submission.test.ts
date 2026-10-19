import { describe, expect, it } from 'vitest';
import {
  prepareCheckoutOrderSubmission,
  type PrepareCheckoutOrderSubmissionOptions,
} from './prepare-checkout-order-submission';

function input(
  overrides: Partial<PrepareCheckoutOrderSubmissionOptions> = {}
): PrepareCheckoutOrderSubmissionOptions {
  return {
    payment: {
      method: 'paystack',
      bankTransferAvailable: true,
      paystackAvailable: true,
      korapayAvailable: true,
      redvaultAvailable: true,
      remainingAmount: 120,
      total: 120,
    },
    delivery: {
      method: 'pickup',
      selectedQuoteId: '',
      selectedQuoteMatchesMethod: false,
      airportRequiresQuote: false,
      airportType: 'delivery',
      quotes: [],
      addresses: [],
      selectedAddressId: null,
      isNewAddressMode: true,
      newAddressStreet: '',
      newAddressCity: '',
      newAddressState: '',
      customerPhone: '08000000000',
      merchantCountry: 'NG',
      deliveryCost: 0,
    },
    identity: {
      merchantId: 'merchant-1',
      customerEmail: 'ada@example.com',
      customerName: 'Ada Customer',
      customerPhone: '08000000000',
      checkoutItems: [],
      useWalletCredit: false,
      walletAmountUsed: 0,
      giftWrappingCost: 0,
    },
    ...overrides,
  };
}

describe('prepareCheckoutOrderSubmission', () => {
  it('preserves delivery selection precedence over payment availability checks', () => {
    const result = prepareCheckoutOrderSubmission(
      input({
        payment: {
          method: 'paystack',
          bankTransferAvailable: true,
          paystackAvailable: false,
          korapayAvailable: true,
          redvaultAvailable: true,
          remainingAmount: 120,
          total: 120,
        },
        delivery: {
          ...input().delivery,
          method: 'door',
          selectedQuoteId: '',
        },
      })
    );

    expect(result).toEqual({ kind: 'issue', issue: 'delivery-option' });
  });

  it('requires complete manual door addresses before producing an order identity', () => {
    const result = prepareCheckoutOrderSubmission(
      input({
        delivery: {
          ...input().delivery,
          method: 'door',
          selectedQuoteId: 'quote-1',
          newAddressStreet: '',
          newAddressCity: 'Lagos',
          newAddressState: 'Lagos',
          quotes: [
            {
              id: 'quote-1',
              provider: 'GIGL',
            } as never,
          ],
        },
      })
    );

    expect(result).toEqual({ kind: 'issue', issue: 'incomplete-address' });
  });

  it('rejects unavailable payment methods before preparing delivery', () => {
    const result = prepareCheckoutOrderSubmission(
      input({
        payment: {
          method: 'paystack',
          bankTransferAvailable: true,
          paystackAvailable: false,
          korapayAvailable: true,
          redvaultAvailable: true,
          remainingAmount: 120,
          total: 120,
        },
      })
    );

    expect(result).toEqual({ kind: 'issue', issue: 'paystack-unavailable' });
  });

  it('requires Klump to charge the full order amount before submitting', () => {
    const result = prepareCheckoutOrderSubmission(
      input({
        payment: {
          method: 'klump',
          bankTransferAvailable: true,
          paystackAvailable: true,
          korapayAvailable: true,
          redvaultAvailable: true,
          remainingAmount: 90,
          total: 120,
        },
      })
    );

    expect(result).toEqual({ kind: 'issue', issue: 'klump-unavailable' });
  });

  it('rejects a selected shipping quote that has expired from the current quote set', () => {
    const result = prepareCheckoutOrderSubmission(
      input({
        delivery: {
          ...input().delivery,
          method: 'door',
          selectedQuoteId: 'quote-expired',
          selectedQuoteMatchesMethod: true,
          newAddressStreet: '1 Test St',
          newAddressCity: 'Lagos',
          newAddressState: 'Lagos',
        },
      })
    );

    expect(result).toEqual({ kind: 'issue', issue: 'shipping-expired' });
  });

  it('freezes pickup address and normalized payment identity for order creation', () => {
    const result = prepareCheckoutOrderSubmission(input());

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.delivery.address).toMatchObject({
      address: 'Pickup at Store',
      city: 'Lagos',
      state: 'Lagos',
      phone: '08000000000',
      countryCode: 'NG',
    });
    expect(result.identity.normalizedPaymentMethod).toBe('card');
    expect(result.identity.checkoutFingerprint).toContain('merchant-1');
  });
});

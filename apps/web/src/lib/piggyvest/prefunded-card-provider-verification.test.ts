import { describe, expect, it, vi } from 'vitest';
import { createPrefundedCardProvider } from './prefunded-card-provider';

import { prefundedCardProviderTestFixture } from './prefunded-card-provider.test-fixture';

vi.mock('server-only', () => ({}));

const { claim, providerSettings, savedMethod, jsonResponse } =
  prefundedCardProviderTestFixture;

describe('prefunded provider verified finality', () => {
  it('defers incomplete PiggyVest TSQ evidence instead of completing funding', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      jsonResponse({
        status: true,
        data: {
          reference: claim.transferReference,
          status: 'success',
          amount: claim.amountKobo,
        },
      })
    );
    const provider = createPrefundedCardProvider({
      settings: providerSettings,
      fetchImplementation,
      resolveSavedMethod: vi.fn(),
    });

    await expect(provider.verifyTransfer(claim)).resolves.toEqual({
      outcome: 'deferred',
    });
  });

  it('accepts complete normalized PiggyVest transfer evidence with a UUID transaction id', async () => {
    const provider = createPrefundedCardProvider({
      settings: providerSettings,
      fetchImplementation: vi.fn().mockResolvedValue(
        jsonResponse({
          status: true,
          data: {
            id: '4680cf0b-cd3f-4a74-ad14-bd4cc9876dd4',
            reference: claim.transferReference,
            status: 'success',
            amount: claim.amountKobo,
            currency: claim.currency,
            business_id: claim.businessId,
            source_wallet: claim.sourceWalletId,
            destination_wallet: claim.destinationWalletId,
            destination_customer_id: claim.destinationCustomerId,
          },
        })
      ),
      resolveSavedMethod: vi.fn(),
    });

    await expect(provider.verifyTransfer(claim)).resolves.toEqual({
      outcome: 'verified_success',
      evidence: expect.objectContaining({
        providerTransactionId: '4680cf0b-cd3f-4a74-ad14-bd4cc9876dd4',
      }),
    });
  });

  it('defers numeric PiggyVest transaction ids even when the other evidence matches', async () => {
    const provider = createPrefundedCardProvider({
      settings: providerSettings,
      fetchImplementation: vi.fn().mockResolvedValue(
        jsonResponse({
          status: true,
          data: {
            id: 123,
            reference: claim.transferReference,
            status: 'success',
            amount: claim.amountKobo,
            currency: claim.currency,
            business_id: claim.businessId,
            source_wallet: claim.sourceWalletId,
            destination_wallet: claim.destinationWalletId,
            destination_customer_id: claim.destinationCustomerId,
          },
        })
      ),
      resolveSavedMethod: vi.fn(),
    });

    await expect(provider.verifyTransfer(claim)).resolves.toEqual({
      outcome: 'deferred',
    });
  });

  it('does not treat a failed Paystack envelope as verified collection evidence', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      jsonResponse({
        status: false,
        data: {
          id: 123,
          domain: 'test',
          status: 'success',
          reference: claim.collectionReference,
          amount: claim.amountKobo,
          currency: 'NGN',
          customer: {
            customer_code: savedMethod.paystackCustomerCode,
            email: savedMethod.email,
          },
          authorization: { authorization_code: savedMethod.authorizationCode },
        },
      })
    );
    const provider = createPrefundedCardProvider({
      settings: providerSettings,
      fetchImplementation,
      resolveSavedMethod: vi.fn().mockResolvedValue(savedMethod),
    });

    await expect(provider.verifyCollection(claim)).resolves.toEqual({
      outcome: 'reconciliation_required',
    });
  });

  it.each([
    ['reference', 'other-reference'],
    ['amount', 4000],
    ['currency', 'USD'],
    ['domain', 'live'],
    ['customer', { customer_code: 'CUS_other', email: savedMethod.email }],
    [
      'customer',
      {
        customer_code: savedMethod.paystackCustomerCode,
        email: 'other@example.test',
      },
    ],
    ['authorization', { authorization_code: 'AUTH_other' }],
    ['id', Number.NaN],
    ['id', Number.POSITIVE_INFINITY],
    ['id', Number.MAX_SAFE_INTEGER + 1],
    ['id', ' 123 '],
  ])('requires exact verified collection evidence when %s is mismatched', async (key, value) => {
    const data = {
      id: 123,
      domain: 'test',
      status: 'success',
      reference: claim.collectionReference,
      amount: claim.amountKobo,
      currency: 'NGN',
      customer: {
        customer_code: savedMethod.paystackCustomerCode,
        email: savedMethod.email,
      },
      authorization: { authorization_code: savedMethod.authorizationCode },
      [key]: value,
    };
    const provider = createPrefundedCardProvider({
      settings: providerSettings,
      fetchImplementation: vi
        .fn()
        .mockResolvedValue(jsonResponse({ status: true, data })),
      resolveSavedMethod: vi.fn().mockResolvedValue(savedMethod),
    });

    await expect(provider.verifyCollection(claim)).resolves.toEqual({
      outcome: 'reconciliation_required',
    });
  });

  it('quarantines a reversed collection instead of releasing its reservation', async () => {
    const provider = createPrefundedCardProvider({
      settings: providerSettings,
      fetchImplementation: vi.fn().mockResolvedValue(
        jsonResponse({
          status: true,
          data: {
            id: 123,
            domain: 'test',
            status: 'reversed',
            reference: claim.collectionReference,
            amount: claim.amountKobo,
            currency: 'NGN',
            customer: {
              customer_code: savedMethod.paystackCustomerCode,
              email: savedMethod.email,
            },
            authorization: {
              authorization_code: savedMethod.authorizationCode,
            },
          },
        })
      ),
      resolveSavedMethod: vi.fn().mockResolvedValue(savedMethod),
    });

    await expect(provider.verifyCollection(claim)).resolves.toEqual({
      outcome: 'reconciliation_required',
    });
  });

  it('verifies a historical collection after its saved method is deactivated', async () => {
    const provider = createPrefundedCardProvider({
      settings: providerSettings,
      fetchImplementation: vi.fn().mockResolvedValue(
        jsonResponse({
          status: true,
          data: {
            id: '18446744073709551615',
            domain: 'test',
            status: 'success',
            reference: claim.collectionReference,
            amount: claim.amountKobo,
            currency: 'NGN',
            customer: {
              customer_code: savedMethod.paystackCustomerCode,
              email: savedMethod.email,
            },
            authorization: {
              authorization_code: savedMethod.authorizationCode,
            },
          },
        })
      ),
      resolveSavedMethod: vi
        .fn()
        .mockResolvedValue({ ...savedMethod, active: false }),
    });

    await expect(provider.verifyCollection(claim)).resolves.toEqual({
      outcome: 'verified_success',
      evidence: {
        reference: claim.collectionReference,
        amountKobo: claim.amountKobo,
        currency: claim.currency,
        savedMethodId: claim.savedMethodId,
        providerTransactionId: '18446744073709551615',
      },
    });
  });

  it('does not verify collection evidence outside the configured immutable scope', async () => {
    const fetchImplementation = vi.fn();
    const provider = createPrefundedCardProvider({
      settings: providerSettings,
      fetchImplementation,
      resolveSavedMethod: vi.fn(),
    });

    await expect(
      provider.verifyCollection({
        ...claim,
        sourceWalletId: 'other_source_wallet',
      })
    ).resolves.toEqual({ outcome: 'reconciliation_required' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

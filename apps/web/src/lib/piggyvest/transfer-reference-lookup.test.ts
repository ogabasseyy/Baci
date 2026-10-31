import { describe, expect, it } from 'vitest';
import { PiggyvestApiError } from './client';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import {
  jsonResponse,
  liveJustSubmittedNotFound,
  liveTransactionStatus,
  liveUnknownReferenceNotFound,
} from './transaction-status-live.test-support';
import {
  classifyTransferReferenceFailure,
  classifyTransferReferenceResponse,
} from './transfer-reference-lookup';

const binding = {
  reference: 'pvb-primary-transfer-00000000-0000-4000-8000-000000000002',
  amountKobo: 25000,
  sourceWalletId: '01JBSYNTHETICTREASURYWALLE',
  destinationWalletId: '01JBSYNTHETICCUSTOMERWALL',
  customerId: '01JBSYNTHETICCUSTOMER00001',
};

async function failureFor(body: unknown, status: number) {
  return await requestPrefundedCardProviderJson({
    url: 'https://staging.piggyvest.business/api/v1/transaction/verify',
    token: 'synthetic-token',
    timeoutMs: 1000,
    maxResponseBytes: 65536,
    fetchImplementation: async () => jsonResponse(body, status),
    init: { method: 'GET' },
  }).then(
    () => {
      throw new Error('Expected the provider request to reject');
    },
    (error: unknown) => error
  );
}

describe('transfer reference lookup classification', () => {
  it('has no positive proof of absence: unknown and just-submitted references answer the same 404', async () => {
    // docs/piggyvest-contract-evidence/2026-10-31.md, P2: both cases answer
    // HTTP 404 "Transaction Not Found". Neither may be read as "never
    // happened".
    for (const body of [
      liveUnknownReferenceNotFound,
      liveJustSubmittedNotFound,
    ]) {
      const failure = await failureFor(body, 404);
      expect(classifyTransferReferenceFailure(failure)).toBe('not_found');
    }
  });

  it('classifies a typed-client 404 as not found', () => {
    expect(
      classifyTransferReferenceFailure(
        new PiggyvestApiError(
          'PIGGYVEST_REQUEST_ERROR',
          'Transaction Not Found',
          404,
          true
        )
      )
    ).toBe('not_found');
  });

  it.each([
    400, 401, 409, 422, 429, 500, 502,
  ])('keeps HTTP %i uncertain', async (status) => {
    expect(
      classifyTransferReferenceFailure(
        await failureFor({ status: false }, status)
      )
    ).toBe('uncertain');
  });

  it('keeps transport failures and non-errors uncertain', () => {
    expect(
      classifyTransferReferenceFailure(new Error('PROVIDER_TIMEOUT'))
    ).toBe('uncertain');
    expect(
      classifyTransferReferenceFailure(
        new PiggyvestApiError('PIGGYVEST_NETWORK_ERROR', 'socket hang up')
      )
    ).toBe('uncertain');
    expect(classifyTransferReferenceFailure({ httpStatus: 404 })).toBe(
      'uncertain'
    );
  });

  it.each([
    ['successful', 'submitted'],
    ['pending', 'pending'],
    ['failed', 'failed'],
  ] as const)('reads a bound live %s record as %s', (status, outcome) => {
    expect(
      classifyTransferReferenceResponse(
        liveTransactionStatus(binding, status),
        binding
      )
    ).toBe(outcome);
  });

  it('does not depend on the provider id equalling the internal reference', () => {
    const live = liveTransactionStatus(binding, 'successful');
    expect(
      classifyTransferReferenceResponse(
        { ...live, data: { ...live.data, internal_reference: 'different' } },
        binding
      )
    ).toBe('submitted');
  });

  it.each([
    { third_party_reference: 'another-reference' },
    { amount: binding.amountKobo + 1 },
    { source_wallet: 'another-wallet' },
    { destination_wallet: 'another-wallet' },
    { currency: 'USD' },
    { status: 'reversed' },
  ])('keeps an unbound or unknown record uncertain: %j', (change) => {
    const live = liveTransactionStatus(binding, 'successful');
    expect(
      classifyTransferReferenceResponse(
        { ...live, data: { ...live.data, ...change } },
        binding
      )
    ).toBe('uncertain');
  });

  it('keeps malformed bodies uncertain', () => {
    for (const body of [
      null,
      'text',
      { status: true },
      { status: true, data: { status: 'successful' } },
      { ...liveTransactionStatus(binding, 'successful'), status: false },
    ])
      expect(classifyTransferReferenceResponse(body, binding)).toBe(
        'uncertain'
      );
  });

  it('still reads the normalized success envelope bound by reference', () => {
    expect(
      classifyTransferReferenceResponse(
        {
          status: true,
          data: {
            status: 'success',
            id: 'provider-transaction',
            reference: binding.reference,
            amount: binding.amountKobo,
            currency: 'NGN',
            business_id: 'business',
            source_wallet: binding.sourceWalletId,
            destination_wallet: binding.destinationWalletId,
            destination_customer_id: 'customer',
          },
        },
        binding
      )
    ).toBe('submitted');
  });
});

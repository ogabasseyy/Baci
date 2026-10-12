import { describe, expect, it, vi } from 'vitest';
import { prefundedCardProviderTestFixture as fixture } from './prefunded-card-provider.test-fixture';
import { createPrefundedCardReversalHandler } from './prefunded-card-reversal';

vi.mock('server-only', () => ({}));

const eventId = 'reversal-delivery-1';
const receipt = {
  operationId: fixture.claim.operationId,
  eventId,
  outcome: 'recorded',
  obligation: 'review_required',
  exposure: 'transfer_not_started',
};

function setup(data: Record<string, unknown> = {}) {
  const body = {
    status: true,
    data: {
      id: 123,
      status: 'reversed',
      domain: 'test',
      reference: fixture.claim.collectionReference,
      amount: fixture.claim.amountKobo,
      currency: 'NGN',
      customer: {
        customer_code: fixture.savedMethod.paystackCustomerCode,
        email: fixture.savedMethod.email,
      },
      authorization: {
        authorization_code: fixture.savedMethod.authorizationCode,
      },
      ...data,
    },
  };
  const fetchImplementation = vi
    .fn()
    .mockResolvedValue(fixture.jsonResponse(body));
  const execute = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [
        {
          result: {
            request: fixture.claim,
            collectionTransactionId: '123',
          },
        },
      ],
    })
    .mockResolvedValue({ rows: [{ result: receipt }] });
  const resolveSavedMethod = vi.fn().mockResolvedValue(fixture.savedMethod);
  const handle = createPrefundedCardReversalHandler({
    execute,
    settings: fixture.providerSettings,
    fetchImplementation,
    resolveSavedMethod,
    expectedSystemId: '12345',
  });
  return { handle, execute, fetchImplementation, resolveSavedMethod };
}

describe('prefunded collection reversal', () => {
  it('verifies the collection and persists scoped evidence without a financial POST', async () => {
    const test = setup();
    await expect(
      test.handle(fixture.claim.operationId, eventId)
    ).resolves.toEqual(receipt);
    expect(test.fetchImplementation).toHaveBeenCalledWith(
      'https://api.paystack.co/transaction/verify/collection-1',
      expect.objectContaining({ method: 'GET', redirect: 'error' })
    );
    const command = JSON.parse(test.execute.mock.calls[1][1][1]);
    expect(command).toMatchObject({
      operationId: fixture.claim.operationId,
      merchantId: fixture.claim.merchantId,
      collectionTransactionId: '123',
      collectionAmountKobo: 5000,
      collectionReference: 'collection-1',
      providerStatus: 'reversed',
      eventId,
    });
    expect(JSON.stringify(command)).not.toContain('authorization_code');
    expect(JSON.stringify(command)).not.toContain(
      fixture.savedMethod.authorizationCode
    );
  });

  it.each([
    { status: 'success' },
    { status: 'failed' },
    { status: 'pending' },
    { domain: 'live' },
    { id: 456 },
    { id: 1.5 },
    { amount: 4999 },
    { amount: '5000' },
    { currency: 'USD' },
    { reference: 'other' },
    { customer: { customer_code: 'other', email: fixture.savedMethod.email } },
    { authorization: { authorization_code: 'other' } },
  ])('does not record unverified or mismatched evidence: %j', async (data) => {
    const test = setup(data);
    await expect(
      test.handle(fixture.claim.operationId, eventId)
    ).resolves.toEqual({ outcome: 'reconciliation_required' });
    expect(test.execute).toHaveBeenCalledTimes(1);
  });

  it('validates the operation and delivery key before accessing storage', async () => {
    const test = setup();
    await expect(test.handle('not-a-uuid', eventId)).rejects.toThrow(
      'Prefunded reversal unavailable'
    );
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant context before looking up a saved method or calling HTTP', async () => {
    const test = setup();
    test.execute.mockReset().mockResolvedValue({
      rows: [
        {
          result: {
            request: { ...fixture.claim, merchantId: fixture.claim.customerId },
            collectionTransactionId: '123',
          },
        },
      ],
    });
    await expect(
      test.handle(fixture.claim.operationId, eventId)
    ).resolves.toEqual({ outcome: 'reconciliation_required' });
    expect(test.fetchImplementation).not.toHaveBeenCalled();
    expect(test.resolveSavedMethod).not.toHaveBeenCalled();
  });

  it('accepts verification with a deactivated method for historical reversal', async () => {
    const test = setup();
    test.resolveSavedMethod.mockResolvedValue({
      ...fixture.savedMethod,
      active: false,
      reusable: false,
    });
    await expect(
      test.handle(fixture.claim.operationId, eventId)
    ).resolves.toEqual(receipt);
  });

  it('reports a transport failure without recording evidence or exposing response bodies', async () => {
    const test = setup();
    test.fetchImplementation.mockRejectedValue(
      new Error('secret-provider-body')
    );
    await expect(
      test.handle(fixture.claim.operationId, eventId)
    ).resolves.toEqual({ outcome: 'reconciliation_required' });
    expect(test.execute).toHaveBeenCalledTimes(1);
  });
});

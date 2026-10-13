import { describe, expect, it, vi } from 'vitest';
import { createPrefundedCardAuthorizationResolver } from './prefunded-card-authorization-resolver';

vi.mock('server-only', () => ({}));

const identity = {
  savedMethodId: '60000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '20000000-0000-4000-8000-000000000001',
};
const scope = {
  treasuryBindingId: '50000000-0000-4000-8000-000000000001',
  integrationId: '40000000-0000-4000-8000-000000000001',
  merchantId: identity.merchantId,
  systemIdentifier: '1234567890123456789',
};
const transactionId = '70000000-0000-4000-8000-000000000001';
const candidate = {
  ...identity,
  transactionId,
  email: 'original@example.test',
  authorizationCode: 'AUTH_synthetic',
  signature: 'SIG_synthetic',
  reference: 'SAV-AUTH-ORIGINAL',
  amountKobo: 5000,
  merchantSlug: 'original-merchant',
};
const receipt = {
  id: 123,
  status: 'success',
  domain: 'test',
  channel: 'card',
  reference: candidate.reference,
  amount: 5000,
  currency: 'NGN',
  customer: { email: candidate.email, customer_code: 'CUS_original' },
  authorization: {
    authorization_code: candidate.authorizationCode,
    signature: candidate.signature,
    reusable: true,
    channel: 'card',
  },
  metadata: {
    customer_id: identity.customerId,
    merchant_slug: candidate.merchantSlug,
    transaction_type: 'savings_authorization',
  },
};
const provisioned = {
  savedMethodId: identity.savedMethodId,
  transactionId,
  outcome: 'provisioned',
};
const message = 'Prefunded card authorization unavailable';

function fixture(data: unknown = receipt, status = 200) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ result: candidate }] })
    .mockResolvedValueOnce({ rows: [{ result: provisioned }] });
  const fetchImplementation = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ status: true, data }), { status })
    );
  const resolver = createPrefundedCardAuthorizationResolver({
    execute,
    scope,
    verification: { paystackSecret: 'sk_test_synthetic', fetchImplementation },
  });
  return { execute, fetchImplementation, resolver };
}

describe('restricted authorization provisioning', () => {
  it('verifies the stored reference before persisting independent test authorization proof', async () => {
    const { resolver, execute, fetchImplementation } = fixture();
    const result = await resolver.provision({ ...identity, transactionId });

    expect(result).toEqual(provisioned);
    expect(JSON.stringify(result)).not.toContain('AUTH_');
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://api.paystack.co/transaction/verify/SAV-AUTH-ORIGINAL',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
      })
    );
    expect(execute).toHaveBeenNthCalledWith(
      1,
      'SELECT prefunded_card.authorization_candidate($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::text) AS result',
      [
        scope.treasuryBindingId,
        scope.integrationId,
        identity.merchantId,
        identity.customerId,
        identity.savedMethodId,
        transactionId,
        scope.systemIdentifier,
      ]
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      'SELECT prefunded_card.provision_authorization($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::text,$8::jsonb) AS result',
      [
        scope.treasuryBindingId,
        scope.integrationId,
        identity.merchantId,
        identity.customerId,
        identity.savedMethodId,
        transactionId,
        scope.systemIdentifier,
        JSON.stringify({ ...receipt, id: '123' }),
      ]
    );
  });

  it.each([
    { name: 'domain', value: { ...receipt, domain: 'live' } },
    { name: 'missing domain', value: { ...receipt, domain: undefined } },
    { name: 'amount', value: { ...receipt, amount: 1 } },
    { name: 'currency', value: { ...receipt, currency: 'USD' } },
    { name: 'reference', value: { ...receipt, reference: 'OTHER' } },
    {
      name: 'customer',
      value: {
        ...receipt,
        metadata: {
          ...receipt.metadata,
          customer_id: '20000000-0000-4000-8000-000000000002',
        },
      },
    },
    {
      name: 'merchant',
      value: {
        ...receipt,
        metadata: { ...receipt.metadata, merchant_slug: 'other' },
      },
    },
    {
      name: 'email',
      value: {
        ...receipt,
        customer: { ...receipt.customer, email: 'other@example.test' },
      },
    },
    {
      name: 'code missing',
      value: { ...receipt, customer: { email: candidate.email } },
    },
    {
      name: 'authorization',
      value: {
        ...receipt,
        authorization: {
          ...receipt.authorization,
          authorization_code: 'AUTH_other',
        },
      },
    },
    {
      name: 'signature',
      value: {
        ...receipt,
        authorization: { ...receipt.authorization, signature: 'SIG_other' },
      },
    },
    {
      name: 'reusable',
      value: {
        ...receipt,
        authorization: { ...receipt.authorization, reusable: false },
      },
    },
    {
      name: 'unsafe numeric id',
      value: { ...receipt, id: Number.MAX_SAFE_INTEGER + 1 },
    },
    { name: 'overflow id', value: { ...receipt, id: '18446744073709551616' } },
    { name: 'pending', value: { ...receipt, status: 'pending' } },
  ])('does not persist mismatched verified $name evidence', async ({
    value,
  }) => {
    const { resolver, execute } = fixture(value);
    await expect(
      resolver.provision({ ...identity, transactionId })
    ).rejects.toThrow(message);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    'sk_live_synthetic',
    'malformed',
    'sk_test_',
  ])('rejects unsafe key %s before database and HTTP', async (paystackSecret) => {
    const execute = vi.fn();
    const fetchImplementation = vi.fn();
    const resolver = createPrefundedCardAuthorizationResolver({
      execute,
      scope,
      verification: { paystackSecret, fetchImplementation },
    });
    await expect(
      resolver.provision({ ...identity, transactionId })
    ).rejects.toThrow(message);
    expect(execute).not.toHaveBeenCalled();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    202, 302, 500,
  ])('does not persist an HTTP %s response as verification', async (status) => {
    const { resolver, execute } = fixture(receipt, status);
    await expect(
      resolver.provision({ ...identity, transactionId })
    ).rejects.toThrow(message);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects a substituted database candidate before HTTP', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          result: {
            ...candidate,
            customerId: '20000000-0000-4000-8000-000000000002',
          },
        },
      ],
    });
    const fetchImplementation = vi.fn();
    const resolver = createPrefundedCardAuthorizationResolver({
      execute,
      scope,
      verification: {
        paystackSecret: 'sk_test_synthetic',
        fetchImplementation,
      },
    });
    await expect(
      resolver.provision({ ...identity, transactionId })
    ).rejects.toThrow(message);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('redacts provider transport errors and does not write a binding', async () => {
    const { resolver, execute, fetchImplementation } = fixture();
    fetchImplementation.mockRejectedValue(
      new Error('AUTH_sensitive provider body')
    );
    await expect(
      resolver.provision({ ...identity, transactionId })
    ).rejects.toThrow(message);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('refuses a substituted provisioning acknowledgement', async () => {
    const { resolver, execute } = fixture();
    execute
      .mockReset()
      .mockResolvedValueOnce({ rows: [{ result: candidate }] })
      .mockResolvedValueOnce({
        rows: [
          {
            result: {
              ...provisioned,
              savedMethodId: '60000000-0000-4000-8000-000000000002',
            },
          },
        ],
      });
    await expect(
      resolver.provision({ ...identity, transactionId })
    ).rejects.toThrow(message);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

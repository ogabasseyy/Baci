import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PREFUNDED_CARD_POSTGRES_STATEMENTS as statements } from './prefunded-card-postgres-statements';
import { createPrefundedCardReplayEnrollment } from './prefunded-card-replay-enrollment';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

vi.mock('server-only', () => ({}));

function configuration() {
  return {
    databaseName: 'prefunded_card_local',
    scope: {
      environment: 'staging',
      integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
      merchantId: '11111111-1111-4111-8111-111111111111',
      treasuryBindingId: '50000000-0000-4000-8000-000000000001',
      businessId: 'business',
      expectedSystemId: '123',
    },
  };
}

function bankEnvelope() {
  return {
    eventId: 'event-1',
    eventType: 'bank-transfer.inflow.success',
    eventCategory: 'inflow_transaction',
    customer_id: 'provider-customer',
    pvb_wallet: 'outer-wallet',
    pvb_reference: 'provider-transaction',
    pvb_destination_wallet: null,
    pvb_third_party_reference: null,
    eventData: {
      id: 'provider-transaction',
      transaction_id: 'provider-transaction',
      reference: 'bank-reference',
      third_party_reference: null,
      internal_reference: null,
      initiator_reference: null,
      session_id: null,
      customer_id: 'provider-customer',
      destination_wallet_id: 'enrolled-wallet',
      type: 'inter',
      status: 'COMPLETED',
      category: 'bank_transfer_inflow',
      amount: 10000,
      currency: 'NGN',
      fee: 0,
    },
  };
}

function receipt(envelope: unknown = bankEnvelope()) {
  const rawPayload = new TextEncoder().encode(JSON.stringify(envelope));
  return {
    receiptId: 'receipt-1',
    payloadSha256: createHash('sha256').update(rawPayload).digest('hex'),
    eventId: 'event-1',
    eventType: 'bank-transfer.inflow.success',
    providerCustomerId: 'provider-customer',
    rawPayload,
  };
}

function setup(rows: unknown[] = [{ result: 'enrolled' }]) {
  const execute = vi
    .fn<PiggyvestProvisioningExecutor>()
    .mockResolvedValue({ rows });
  return {
    execute,
    resolve: createPrefundedCardReplayEnrollment({
      configuration: configuration(),
      execute,
    }),
  };
}

describe('prefunded receipt enrollment routing', () => {
  it('routes the real inter/COMPLETED bank shape before signatures or evidence exist', async () => {
    const { execute, resolve } = setup();
    await expect(resolve(receipt())).resolves.toBe('enrolled');
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      statements.resolveReplayEnrollment.text,
      [
        configuration().scope.integrationId,
        configuration().scope.merchantId,
        configuration().scope.treasuryBindingId,
        'business',
        'prefunded_card_local',
        '123',
        JSON.stringify({
          eventType: 'bank-transfer.inflow.success',
          envelopeWalletId: 'outer-wallet',
          envelopeCustomerId: 'provider-customer',
          destinationWalletId: 'enrolled-wallet',
          innerCustomerId: 'provider-customer',
          sourceWalletId: null,
          declaredDestinationWalletId: null,
          references: ['provider-transaction', 'bank-reference'],
        }),
      ]
    );
    expect(JSON.stringify(execute.mock.calls)).not.toContain('COMPLETED');
    expect(JSON.stringify(execute.mock.calls)).not.toContain('amount');
  });

  it.each([
    'payloadSha256',
    'eventId',
    'eventType',
    'providerCustomerId',
  ])('refuses mismatching receipt %s without DB access', async (field) => {
    const { execute, resolve } = setup();
    await expect(resolve({ ...receipt(), [field]: 'different' })).resolves.toBe(
      'deferred'
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('checks the digest of exact original bytes, not reserialized JSON', async () => {
    const { execute, resolve } = setup();
    const request = receipt();
    request.rawPayload = new TextEncoder().encode(
      JSON.stringify(bankEnvelope(), null, 2)
    );
    await expect(resolve(request)).resolves.toBe('deferred');
    expect(execute).not.toHaveBeenCalled();
    request.payloadSha256 = createHash('sha256')
      .update(request.rawPayload)
      .digest('hex');
    await expect(resolve(request)).resolves.toBe('enrolled');
  });

  it.each([
    new Uint8Array(),
    new Uint8Array(65_537),
    new Uint8Array([255]),
    '{}',
    null,
  ])('defers invalid original bytes without SQL', async (rawPayload) => {
    const { execute, resolve } = setup();
    const input = { ...receipt(), rawPayload };
    if (rawPayload instanceof Uint8Array)
      input.payloadSha256 = createHash('sha256')
        .update(rawPayload)
        .digest('hex');
    await expect(resolve(input)).resolves.toBe('deferred');
    expect(execute).not.toHaveBeenCalled();
  });

  it('defers mismatched inner ownership and explicit destination hints', async () => {
    const { execute, resolve } = setup();
    const envelope = bankEnvelope();
    envelope.eventData.customer_id = 'different-customer';
    await expect(resolve(receipt(envelope))).resolves.toBe('deferred');
    await expect(
      resolve(
        receipt({
          ...bankEnvelope(),
          pvb_destination_wallet: 'different-wallet',
        })
      )
    ).resolves.toBe('deferred');
    expect(execute).not.toHaveBeenCalled();
  });

  it('defers malformed, missing and oversized identity hints', async () => {
    const { execute, resolve } = setup();
    for (const destination of [null, '', 42, 'x'.repeat(513), undefined]) {
      const envelope = bankEnvelope();
      Reflect.set(envelope.eventData, 'destination_wallet_id', destination);
      await expect(resolve(receipt(envelope))).resolves.toBe('deferred');
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('routes internal hints without confusing sender with destination ownership', async () => {
    const { resolve, execute } = setup();
    const envelope = {
      ...bankEnvelope(),
      eventType: 'wallet-transfer.outflow.success',
      eventCategory: 'wallet-transfer',
      pvb_wallet: 'treasury-wallet',
      eventData: {
        ...bankEnvelope().eventData,
        source_wallet_id: 'treasury-wallet',
      },
    };
    await expect(
      resolve({ ...receipt(envelope), eventType: envelope.eventType })
    ).resolves.toBe('enrolled');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('admits outer bank destination routing without asserting inner destination finality', async () => {
    const { resolve, execute } = setup();
    const envelope = bankEnvelope();
    envelope.pvb_wallet = 'enrolled-wallet';
    envelope.eventData.destination_wallet_id = 'external-provider-wallet';
    await expect(resolve(receipt(envelope))).resolves.toBe('enrolled');
    expect(JSON.stringify(execute.mock.calls)).toContain(
      'external-provider-wallet'
    );
  });

  it('looks up sparse outflows using envelope references without invented inner identities', async () => {
    const { resolve, execute } = setup();
    const envelope = {
      ...bankEnvelope(),
      eventType: 'wallet-transfer.outflow.success',
      eventCategory: 'wallet-transfer',
      pvb_wallet: 'treasury-wallet',
      eventData: {},
    };
    await expect(
      resolve({ ...receipt(envelope), eventType: envelope.eventType })
    ).resolves.toBe('enrolled');
    expect(execute.mock.calls[0][1][6]).toBe(
      JSON.stringify({
        eventType: envelope.eventType,
        envelopeWalletId: 'treasury-wallet',
        envelopeCustomerId: 'provider-customer',
        destinationWalletId: null,
        innerCustomerId: null,
        sourceWalletId: null,
        declaredDestinationWalletId: null,
        references: ['provider-transaction'],
      })
    );
  });

  it.each([
    'enrolled',
    'legacy',
    'deferred',
  ])('returns %s only from the restricted database result', async (result) => {
    const { resolve } = setup([{ result }]);
    await expect(resolve(receipt())).resolves.toBe(result);
  });

  it.each([
    { rows: [] },
    { rows: [{ result: 'unknown' }] },
    { rows: [{ result: 'legacy' }, { result: 'enrolled' }] },
  ])('never assigns legacy on missing or ambiguous lookup rows', async ({
    rows,
  }) => {
    const { resolve } = setup(rows);
    await expect(resolve(receipt())).resolves.toBe('deferred');
  });

  it('redacts database errors and snapshots independently configured scope', async () => {
    const execute = vi
      .fn<PiggyvestProvisioningExecutor>()
      .mockRejectedValue(new Error('password=private provider response'));
    const config = configuration();
    const resolve = createPrefundedCardReplayEnrollment({
      configuration: config,
      execute,
    });
    config.scope.businessId = 'untrusted-change';
    await expect(resolve(receipt())).resolves.toBe('deferred');
    expect(execute.mock.calls[0][1][3]).toBe('business');
    expect(() =>
      createPrefundedCardReplayEnrollment({
        configuration: { ...config, profile: 'evidence' },
        execute,
      })
    ).toThrow(new Error('Prefunded enrollment unavailable'));
  });
});

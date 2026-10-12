import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createPrefundedCardReplayEnrollment } from './prefunded-card-replay-enrollment';
import { prefundedCardSignedOutflowFixture as fixture } from './prefunded-card-signed-outflow.test-fixture';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

vi.mock('server-only', () => ({}));

function setup() {
  const envelope = structuredClone(fixture.envelope);
  const execute = vi
    .fn<PiggyvestProvisioningExecutor>()
    .mockResolvedValue({ rows: [{ result: 'enrolled' }] });
  const resolve = createPrefundedCardReplayEnrollment({
    configuration: {
      databaseName: 'postgres',
      scope: {
        environment: 'staging',
        integrationId: fixture.configuration.integrationId,
        merchantId: '10000000-0000-4000-8000-000000000001',
        treasuryBindingId: 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57',
        businessId: fixture.configuration.piggyvest.expectedBusinessId,
        expectedSystemId: fixture.configuration.systemIdentifier,
      },
    },
    execute,
  });
  const receipt = () => {
    const rawPayload = new TextEncoder().encode(JSON.stringify(envelope));
    return {
      receiptId: '0f9938ae-8551-4e2e-8816-853e0231b2c3',
      payloadSha256: createHash('sha256').update(rawPayload).digest('hex'),
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      providerCustomerId: envelope.customer_id,
      rawPayload,
    };
  };
  return { envelope, execute, resolve, receipt };
}

describe('bugfix: native wallet_transfer enrollment precedes original signature replay', () => {
  it('routes exact native hints without treating signed FAAS IDs as public wallet identifiers or credit authority', async () => {
    const selected = setup();
    const receipt = selected.receipt();

    await expect(selected.resolve(receipt)).resolves.toBe('enrolled');

    expect(selected.execute).toHaveBeenCalledOnce();
    const hints = JSON.parse(String(selected.execute.mock.calls[0][1][6]));
    expect(hints).toEqual({
      eventType: fixture.envelope.eventType,
      envelopeWalletId: fixture.envelope.pvb_wallet,
      envelopeCustomerId: fixture.envelope.customer_id,
      destinationWalletId: null,
      innerCustomerId: null,
      sourceWalletId: null,
      declaredDestinationWalletId: fixture.envelope.pvb_destination_wallet,
      references: [
        fixture.envelope.pvb_reference,
        fixture.envelope.pvb_third_party_reference,
        fixture.envelope.eventData.id,
        fixture.envelope.eventData.transaction_id,
        fixture.envelope.eventData.reference,
        fixture.envelope.eventData.third_party_reference,
      ],
    });
    expect(selected.receipt().payloadSha256).toBe(receipt.payloadSha256);
    expect(new TextDecoder().decode(receipt.rawPayload)).toContain(
      'wallet_transfer'
    );
    expect(hints).not.toHaveProperty('amount');
    expect(hints).not.toHaveProperty('status');
  });

  it.each([
    'WALLET_TRANSFER',
    'wallet.transfer',
    'wallet-transfer ',
  ])('refuses unreviewed category spelling %s', async (eventCategory) => {
    const selected = setup();
    selected.envelope.eventCategory = eventCategory;

    await expect(selected.resolve(selected.receipt())).resolves.toBe(
      'deferred'
    );

    expect(selected.execute).not.toHaveBeenCalled();
  });

  it.each([
    'reference',
    'internal_reference',
    'third_party_reference',
    'initiator_reference',
  ])('refuses structurally contradictory native %s hints', async (field) => {
    const selected = setup();
    selected.envelope.eventData = {
      ...selected.envelope.eventData,
      [field]: 'foreign-reference',
    };

    await expect(selected.resolve(selected.receipt())).resolves.toBe(
      'deferred'
    );

    expect(selected.execute).not.toHaveBeenCalled();
  });

  it('does not alter the immutable raw-byte digest gate', async () => {
    const selected = setup();
    const receipt = selected.receipt();
    receipt.rawPayload[5] ^= 1;

    await expect(selected.resolve(receipt)).resolves.toBe('deferred');
    await expect(
      selected.resolve({
        ...selected.receipt(),
        rawPayload: new TextEncoder().encode('{}'),
      })
    ).resolves.toBe('deferred');

    expect(selected.execute).not.toHaveBeenCalled();
  });

  it('does not enroll sparse native aliases even when their raw-byte digest matches', async () => {
    const selected = setup();
    const rawPayload = new TextEncoder().encode(
      JSON.stringify({
        ...selected.envelope,
        eventData: {},
      })
    );

    await expect(
      selected.resolve({
        ...selected.receipt(),
        rawPayload,
        payloadSha256: createHash('sha256').update(rawPayload).digest('hex'),
      })
    ).resolves.toBe('deferred');

    expect(selected.execute).not.toHaveBeenCalled();
  });
});

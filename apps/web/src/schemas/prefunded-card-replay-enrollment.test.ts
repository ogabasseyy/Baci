import { describe, expect, it } from 'vitest';
import { prefundedCardReplayEnrollmentSchemas as schemas } from './prefunded-card-replay-enrollment';

function hints() {
  return {
    eventType: 'bank-transfer.inflow.success',
    envelopeWalletId: 'outer-wallet',
    envelopeCustomerId: 'customer',
    destinationWalletId: 'destination-wallet',
    innerCustomerId: 'customer',
    sourceWalletId: null,
    declaredDestinationWalletId: null,
    references: ['reference'],
  };
}

describe('prefunded receipt enrollment schemas', () => {
  it('accepts the six-field receiver contract without any signature', () => {
    const input = {
      receiptId: 'receipt',
      payloadSha256: 'a'.repeat(64),
      eventId: 'event',
      eventType: 'bank-transfer.inflow.success',
      providerCustomerId: 'customer',
      rawPayload: new Uint8Array([123, 125]),
    };
    expect(schemas.input.safeParse(input).success).toBe(true);
    expect(
      schemas.input.safeParse({ ...input, fingerprint: 'a'.repeat(64) }).success
    ).toBe(false);
    expect(
      schemas.input.safeParse({ ...input, payloadSha256: undefined }).success
    ).toBe(false);
    expect(
      schemas.input.safeParse({ ...input, eventType: 'unrecognized' }).success
    ).toBe(false);
  });

  it('bounds identifier bytes, whitespace and reference cardinality', () => {
    expect(schemas.hints.safeParse(hints()).success).toBe(true);
    for (const value of ['', 'a b', '\u0000', 'x'.repeat(513), 'é'.repeat(257)])
      expect(
        schemas.hints.safeParse({ ...hints(), destinationWalletId: value })
          .success
      ).toBe(false);
    expect(
      schemas.hints.safeParse({
        ...hints(),
        destinationWalletId: 'é'.repeat(256),
      }).success
    ).toBe(true);
    for (const references of [[], new Array(17).fill('reference'), [null]])
      expect(schemas.hints.safeParse({ ...hints(), references }).success).toBe(
        false
      );
  });

  it('requires exact bounded JSON hints for the executor parameter', () => {
    expect(
      schemas.serializedHints.safeParse(JSON.stringify(hints())).success
    ).toBe(true);
    for (const value of ['null', '[]', '{', '{}', ' '.repeat(16_385)])
      expect(schemas.serializedHints.safeParse(value).success).toBe(false);
    expect(
      schemas.serializedHints.safeParse(
        JSON.stringify({
          ...hints(),
          enrolled: true,
        })
      ).success
    ).toBe(false);
  });

  it('allows sparse outflow hints but keeps bank destination and customer mandatory', () => {
    const sparse = {
      ...hints(),
      destinationWalletId: null,
      innerCustomerId: null,
    };
    expect(schemas.hints.safeParse(sparse).success).toBe(false);
    expect(
      schemas.hints.safeParse({
        ...sparse,
        eventType: 'wallet-transfer.outflow.success',
      }).success
    ).toBe(true);
  });

  it('does not impose monetary evidence semantics on the supplied bank shape', () => {
    expect(
      schemas.envelope.safeParse({
        eventId: 'event',
        eventType: 'bank-transfer.inflow.success',
        eventCategory: 'inflow_transaction',
        customer_id: 'customer',
        pvb_wallet: 'outer-wallet',
        pvb_reference: 'reference',
        pvb_destination_wallet: null,
        pvb_third_party_reference: null,
        eventData: {
          customer_id: 'customer',
          destination_wallet_id: 'different-inner-wallet',
          type: 'inter',
          status: 'COMPLETED',
          category: 'bank_transfer_inflow',
          session_id: null,
          reference: null,
          third_party_reference: null,
        },
      }).success
    ).toBe(true);
  });

  it('requires immutable physical scope configuration without request-selected profiles', () => {
    const config = {
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
    expect(schemas.configuration.safeParse(config).success).toBe(true);
    for (const databaseName of ['', 'other/database', 'x'.repeat(64)])
      expect(
        schemas.configuration.safeParse({ ...config, databaseName }).success
      ).toBe(false);
    expect(
      schemas.configuration.safeParse({ ...config, profile: 'worker' }).success
    ).toBe(false);
    expect(
      schemas.configuration.safeParse({
        ...config,
        scope: { ...config.scope, batchSize: 5 },
      }).success
    ).toBe(false);
    expect(
      schemas.configuration.safeParse({
        ...config,
        scope: { ...config.scope, expectedSystemId: undefined },
      }).success
    ).toBe(false);
  });

  it('requires exactly one redacted routing outcome', () => {
    expect(schemas.rows.safeParse([{ result: 'legacy' }]).success).toBe(true);
    for (const rows of [
      [],
      [{ result: null }],
      [{ result: 'legacy', secret: true }],
    ])
      expect(schemas.rows.safeParse(rows).success).toBe(false);
  });
});

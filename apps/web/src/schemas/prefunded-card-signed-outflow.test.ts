import { describe, expect, it } from 'vitest';
import { prefundedCardSignedOutflowFixture as fixture } from '../lib/piggyvest/prefunded-card-signed-outflow.test-fixture';
import { prefundedCardSignedOutflowSchemas as schemas } from './prefunded-card-signed-outflow';

describe('captured-shaped signed outflow namespaces', () => {
  it('retains FAAS UUIDs, public references and a null webhook fee without inventing a TSQ customer UUID', () => {
    const event = schemas.signed.parse(fixture.envelope);
    const transaction = schemas.transaction.parse(fixture.transaction);

    expect(event.eventData.fee).toBeNull();
    expect(event.eventData.transaction_id).not.toBe(transaction.data.id);
    expect(transaction.data.customer_id).not.toBe(event.customer_id);
    expect(transaction.data).not.toHaveProperty('destination_customer_id');
    expect(transaction.data).not.toHaveProperty('currency');
    expect(schemas.wallet.safeParse(fixture.sourceWallet).success).toBe(true);
    expect(schemas.wallet.safeParse(fixture.destinationWallet).success).toBe(
      true
    );
  });

  it.each([
    ['eventCategory', 'wallet-transfer'],
    ['eventCategory', 'WALLET_TRANSFER'],
    ['customer_id', fixture.configuration.piggyvest.expectedBusinessId],
    ['pvb_wallet', ' public-wallet'],
    ['pvb_destination_wallet', fixture.envelope.pvb_wallet],
    ['pvb_third_party_reference', ''],
  ])('rejects a malformed or changed signed %s boundary', (field, value) => {
    expect(
      schemas.signed.safeParse({ ...fixture.envelope, [field]: value }).success
    ).toBe(false);
  });

  it.each([
    ['id', 'provider-id'],
    ['transaction_id', 123],
    ['amount', '10000'],
    ['amount', 10000.5],
    ['amount', Number.MAX_SAFE_INTEGER + 1],
    ['fee', undefined],
    ['fee', '0'],
    ['fee', 1],
    ['status', 'success'],
    ['currency', 'ngn'],
    ['source_wallet', fixture.envelope.eventData.destination_wallet],
    ['internal_reference', 'foreign-reference'],
    ['initiator_reference', 'foreign-provider-id'],
  ])('rejects a malformed or contradictory signed data %s', (field, value) => {
    expect(
      schemas.signed.safeParse({
        ...fixture.envelope,
        eventData: { ...fixture.envelope.eventData, [field]: value },
      }).success
    ).toBe(false);
  });

  it.each([
    'transaction',
    'wallet',
    'wallets',
  ] as const)('requires a successful authenticated %s envelope', (kind) => {
    const response =
      kind === 'transaction'
        ? fixture.transaction
        : kind === 'wallet'
          ? fixture.destinationWallet
          : fixture.walletList;
    expect(
      schemas[kind].safeParse({ ...response, status: false }).success
    ).toBe(false);
  });

  it('requires an explicit authenticated FAAS alias without replacing it with the public wallet ID', () => {
    const { faas_wallet_identifier: _alias, ...data } =
      fixture.destinationWallet.data;
    expect(schemas.wallet.safeParse({ status: true, data }).success).toBe(
      false
    );
  });
});

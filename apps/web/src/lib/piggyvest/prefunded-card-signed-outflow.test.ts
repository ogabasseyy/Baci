import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { prefundedCardSignedOutflowFixture as fixture } from './prefunded-card-signed-outflow.test-fixture';
import { setupSignedOutflowReplay as setup } from './prefunded-card-signed-outflow.test-support';

vi.mock('server-only', () => ({}));

describe('bugfix: authentic-shaped FAAS outflow replay', () => {
  it('correlates signed customer UUID, public wallet IDs and rich TSQ references without projecting a bank inflow', async () => {
    const selected = setup();

    await expect(selected.replay(selected.receipt())).resolves.toEqual({
      outcome: 'processed',
      projection: 'not_applicable',
    });

    expect(selected.observations.at(-1)).toMatchObject({
      status: 'verified',
      kind: 'internal_transfer',
      eventCategory: 'wallet-transfer',
      eventDataId: '34c57f9b-8697-46a9-954f-b93bfd888a36',
      providerTransactionId: 'PVB01M3YP6SFJQTJQWE83SC5RMX1V',
      reference: 'pvbt-ff561046-58e7-428d-9163-f6e60b0dab65',
      sourceWalletId: '01M238A0V75387H4HZ15YFWGX3',
      destinationWalletId: '01M3W0Y93XHJY9RPQ2G75X81WG',
      destinationCustomerId: 'c096507d-dc32-45d2-9c01-871a27abfd10',
      amountKobo: 10000,
      feeKobo: 0,
      currency: 'NGN',
    });
    expect(selected.observations).toHaveLength(2);
    const fingerprint = createHash('sha256')
      .update(selected.receipt().rawPayload)
      .digest('hex');
    for (const observation of selected.observations) {
      expect(observation).toMatchObject({
        eventId: fixture.envelope.eventId,
        eventCategory: 'wallet-transfer',
        fingerprint,
      });
    }
    expect(selected.sample.envelope.eventCategory).toBe('wallet_transfer');
    expect(selected.sample.envelope.pvb_reference).not.toBe(
      selected.sample.transaction.data.id
    );
    expect(selected.ledgerExecute).not.toHaveBeenCalled();
    expect(selected.observations.at(-1)?.references).toEqual(
      expect.arrayContaining([
        'PVB01M3YP7BF72MD3PXVY2G8ZXCS0',
        'PVB01M3YP6SFJQTJQWE83SC5RMX1V',
        '01M3YP6VMSZX61CMB5V4Z07RAJ',
        'pvbt-ff561046-58e7-428d-9163-f6e60b0dab65',
      ])
    );
    expect(selected.fetchImplementation).toHaveBeenCalledTimes(4);
    for (const [, options] of selected.fetchImplementation.mock.calls) {
      expect(options).toMatchObject({
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
      });
      expect(options?.body).toBeUndefined();
    }
  });

  it.each([
    ['status', 'success'],
    ['status', 'pending'],
    ['id', 'foreign-provider-id'],
    ['internal_reference', 'foreign-provider-id'],
    ['reference', 'foreign-public-reference'],
    ['third_party_reference', 'foreign-operation-reference'],
    ['customer_id', fixture.envelope.customer_id],
    ['source_wallet', fixture.envelope.eventData.source_wallet],
    ['destination_wallet', fixture.envelope.eventData.destination_wallet],
    ['amount', 10001],
    ['amount', '10000'],
    ['amount', Number.MAX_SAFE_INTEGER + 1],
    ['fee', 1],
    ['fee', null],
    ['currency', 'USD'],
    ['business_id', 'foreign-business'],
    ['destination_customer_id', 'foreign-customer'],
  ])('does not verify a contradictory rich TSQ %s', async (field, value) => {
    const selected = setup();
    selected.sample.transaction.data = {
      ...selected.sample.transaction.data,
      [field]: value,
    };

    await expect(selected.replay(selected.receipt())).resolves.toEqual({
      outcome: 'retry',
      stage: 'evidence',
    });

    expect(
      selected.observations.every(
        (observation) => observation.status === 'deferred'
      )
    ).toBe(true);
    expect(selected.ledgerExecute).not.toHaveBeenCalled();
  });

  it.each([
    ['source_wallet', 'foreign-faas-source'],
    ['destination_wallet', 'foreign-faas-destination'],
    ['status', 'successful'],
    ['status', 'completed'],
    ['fee', 1],
    ['currency', 'USD'],
    ['amount', 9999],
    ['reference', 'foreign-reference'],
    ['internal_reference', 'foreign-reference'],
    ['third_party_reference', 'foreign-provider-transaction'],
    ['initiator_reference', 'foreign-provider-transaction'],
  ])('does not discard an authentic-shaped contradictory event field %s', async (field, value) => {
    const selected = setup();
    selected.sample.envelope.eventData = {
      ...selected.sample.envelope.eventData,
      [field]: value,
    };

    await expect(selected.replay(selected.receipt())).resolves.toEqual({
      outcome: 'retry',
      stage: 'evidence',
    });

    expect(
      selected.observations.every(
        (observation) => observation.status === 'deferred'
      )
    ).toBe(true);
    expect(selected.ledgerExecute).not.toHaveBeenCalled();
  });

  it.each([
    'sourceWallet',
    'destinationWallet',
  ] as const)('rejects foreign public/FAAS/business/currency identity for %s', async (wallet) => {
    for (const [field, value] of [
      ['id', 'foreign-public-wallet'],
      ['faas_wallet_identifier', 'foreign-faas-wallet'],
      ['business_id', 'foreign-business'],
      ['currency', 'USD'],
      ['status', 'inactive'],
    ]) {
      const selected = setup();
      selected.sample[wallet].data = {
        ...selected.sample[wallet].data,
        [field]: value,
      };

      await expect(selected.replay(selected.receipt())).resolves.toEqual({
        outcome: 'retry',
        stage: 'evidence',
      });

      expect(
        selected.observations.every(
          (observation) => observation.status === 'deferred'
        )
      ).toBe(true);
    }
  });

  it('does not fabricate a missing authenticated API customer alias or FAAS wallet alias', async () => {
    for (const field of ['api_customer_id', 'faas_wallet_identifier']) {
      const selected = setup();
      selected.sample.destinationWallet.data = {
        ...selected.sample.destinationWallet.data,
        [field]: undefined,
      };

      await expect(selected.replay(selected.receipt())).resolves.toEqual({
        outcome: 'retry',
        stage: 'evidence',
      });

      expect(
        selected.observations.every(
          (observation) => observation.status === 'deferred'
        )
      ).toBe(true);
    }
  });

  it('requires the signed customer UUID to match the independently scoped destination mapping', async () => {
    const selected = setup();
    selected.sample.envelope.customer_id =
      '10000000-0000-4000-8000-000000000002';
    selected.ingestionExecute.mockImplementation(async (statement) => {
      if (statement.includes('evidence_scope'))
        return {
          rows: [
            {
              result: {
                businessId:
                  selected.sample.configuration.piggyvest.expectedBusinessId,
                currency: 'NGN',
              },
            },
          ],
        };
      if (statement.includes('evidence_destination_mapping'))
        return {
          rows: [
            {
              result: {
                providerWalletId:
                  selected.sample.envelope.pvb_destination_wallet,
                providerCustomerId: fixture.envelope.customer_id,
              },
            },
          ],
        };
      return { rows: [{ result: 'stored' }] };
    });

    await expect(selected.replay(selected.receipt())).resolves.toEqual({
      outcome: 'retry',
      stage: 'evidence',
    });

    expect(
      selected.fetchImplementation.mock.calls
        .map(([url]) => String(url))
        .some((url) => url.includes('/wallet-type?'))
    ).toBe(false);
    expect(selected.ledgerExecute).not.toHaveBeenCalled();
  });

  it.each([
    ['id', 'foreign-public-wallet'],
    ['api_customer_id', 'foreign-api-customer'],
    ['faas_wallet_identifier', 'foreign-faas-wallet'],
    ['faas_wallet_identifier', undefined],
    ['business_id', 'foreign-business'],
    ['currency', 'USD'],
  ])('requires the provider API alias list to corroborate destination %s', async (field, value) => {
    const selected = setup();
    selected.sample.walletList.data.paginatedPayload.edges[0] = {
      ...selected.sample.walletList.data.paginatedPayload.edges[0],
      [field]: value,
    };

    await expect(selected.replay(selected.receipt())).resolves.toEqual({
      outcome: 'retry',
      stage: 'evidence',
    });

    expect(
      selected.observations.every(
        (observation) => observation.status === 'deferred'
      )
    ).toBe(true);
  });

  it('rejects changed raw bytes before provider or database access without re-signing a real receipt', async () => {
    const selected = setup();
    const receipt = selected.receipt();
    receipt.rawPayload[5] ^= 1;

    await expect(selected.replay(receipt)).resolves.toEqual({
      outcome: 'rejected',
    });

    expect(selected.fetchImplementation).not.toHaveBeenCalled();
    expect(selected.ingestionExecute).not.toHaveBeenCalled();
    expect(selected.ledgerExecute).not.toHaveBeenCalled();
  });
});

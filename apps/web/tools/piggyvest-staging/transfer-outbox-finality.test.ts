import { describe, expect, it, vi } from 'vitest';
import { createDurableOutflowStore } from './transfer-outbox-finality';
import { PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS } from './transfer-outbox-finality-statements';

const scopedIdentity = {
  reference: 'synthetic-outflow-001',
  providerCustomerId: 'provider-customer-001',
  businessId: 'business-001',
  integrationId: 'integration-001',
};

const expectedOperation = {
  ...scopedIdentity,
  customerId: 'c0065070-dc32-45d2-9c01-871a27abfd10',
  amountKobo: 500_000,
  currency: 'NGN' as const,
  sourceWalletId: 'source-wallet-001',
  destinationWalletId: '058:6789',
  direction: 'bank' as const,
  status: 'submitted' as const,
};

const terminalEvidence = {
  ...expectedOperation,
  providerTransactionId: 'provider-transaction-001',
};

describe('createDurableOutflowStore', () => {
  it('reads an expected operation only inside its trusted provider scope', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          customer_id: expectedOperation.customerId,
          reference: expectedOperation.reference,
          amount_kobo: String(expectedOperation.amountKobo),
          currency: expectedOperation.currency,
          source_wallet_id: expectedOperation.sourceWalletId,
          destination_ref: expectedOperation.destinationWalletId,
          direction: expectedOperation.direction,
          provider_customer_id: expectedOperation.providerCustomerId,
          business_id: expectedOperation.businessId,
          integration_id: expectedOperation.integrationId,
          status: expectedOperation.status,
        },
      ],
    }));

    const adapter = createDurableOutflowStore({
      execute: query,
      expectedSystemId: '7685292944002592802',
      businessId: scopedIdentity.businessId,
      integrationId: scopedIdentity.integrationId,
    });

    await expect(adapter.findExpected(scopedIdentity)).resolves.toEqual(
      expectedOperation
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('read_piggyvest_transfer_outbox_finality'),
      [
        '7685292944002592802',
        scopedIdentity.reference,
        scopedIdentity.providerCustomerId,
        scopedIdentity.businessId,
        scopedIdentity.integrationId,
      ]
    );
  });

  it('refuses malformed or multiply matched persisted rows', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ reference: 'missing-identities' }] })
      .mockResolvedValueOnce({ rows: [expectedOperation, expectedOperation] });
    const adapter = createDurableOutflowStore({
      execute: query,
      expectedSystemId: '7685292944002592802',
      businessId: scopedIdentity.businessId,
      integrationId: scopedIdentity.integrationId,
    });

    await expect(adapter.findExpected(scopedIdentity)).rejects.toThrow(
      'Outgoing transfer finality lookup returned an invalid row'
    );
    await expect(adapter.findExpected(scopedIdentity)).rejects.toThrow(
      'Outgoing transfer finality lookup returned multiple rows'
    );
  });

  it.each([
    ['reference', 'synthetic-outflow-spoofed'],
    ['provider_customer_id', 'provider-customer-spoofed'],
    ['business_id', 'business-spoofed'],
    ['integration_id', 'integration-spoofed'],
  ])('refuses a shape-valid persisted row with spoofed %s', async (field, value) => {
    const query = vi.fn(async () => ({
      rows: [
        {
          customer_id: expectedOperation.customerId,
          reference: expectedOperation.reference,
          amount_kobo: String(expectedOperation.amountKobo),
          currency: expectedOperation.currency,
          source_wallet_id: expectedOperation.sourceWalletId,
          destination_ref: expectedOperation.destinationWalletId,
          direction: expectedOperation.direction,
          provider_customer_id: expectedOperation.providerCustomerId,
          business_id: expectedOperation.businessId,
          integration_id: expectedOperation.integrationId,
          status: expectedOperation.status,
          [field]: value,
        },
      ],
    }));
    const adapter = createDurableOutflowStore({
      execute: query,
      expectedSystemId: '7685292944002592802',
      businessId: scopedIdentity.businessId,
      integrationId: scopedIdentity.integrationId,
    });

    await expect(adapter.findExpected(scopedIdentity)).rejects.toThrow(
      'Outgoing transfer finality lookup returned a mismatched row'
    );
  });

  it('sends the complete identity to the atomic terminal compare-and-set', async () => {
    const query = vi.fn(async () => ({ rows: [{ outcome: 'applied' }] }));
    const adapter = createDurableOutflowStore({
      execute: query,
      expectedSystemId: '7685292944002592802',
      businessId: scopedIdentity.businessId,
      integrationId: scopedIdentity.integrationId,
    });

    await expect(
      adapter.compareAndSetTerminal({
        expected: expectedOperation,
        evidence: terminalEvidence,
        terminalStatus: 'succeeded',
      })
    ).resolves.toBe('applied');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('apply_piggyvest_transfer_outbox_finality'),
      [
        '7685292944002592802',
        expectedOperation.reference,
        expectedOperation.amountKobo,
        expectedOperation.currency,
        expectedOperation.sourceWalletId,
        expectedOperation.destinationWalletId,
        expectedOperation.direction,
        expectedOperation.providerCustomerId,
        expectedOperation.businessId,
        expectedOperation.integrationId,
        terminalEvidence.providerTransactionId,
        'succeeded',
      ]
    );
  });

  it('fails closed when the database returns an unsupported finality result', async () => {
    const query = vi.fn(async () => ({ rows: [{ outcome: 'succeeded' }] }));
    const adapter = createDurableOutflowStore({
      execute: query,
      expectedSystemId: '7685292944002592802',
      businessId: scopedIdentity.businessId,
      integrationId: scopedIdentity.integrationId,
    });

    await expect(
      adapter.compareAndSetTerminal({
        expected: expectedOperation,
        evidence: terminalEvidence,
        terminalStatus: 'succeeded',
      })
    ).rejects.toThrow('Outgoing transfer finality compare-and-set failed');
  });

  it('does not invoke the CAS when evidence differs from the expected operation', async () => {
    const query = vi.fn(async () => ({ rows: [{ outcome: 'applied' }] }));
    const adapter = createDurableOutflowStore({
      execute: query,
      expectedSystemId: '7685292944002592802',
      businessId: scopedIdentity.businessId,
      integrationId: scopedIdentity.integrationId,
    });

    await expect(
      adapter.compareAndSetTerminal({
        expected: expectedOperation,
        evidence: { ...terminalEvidence, amountKobo: 500_001 },
        terminalStatus: 'succeeded',
      })
    ).rejects.toThrow(
      'Outgoing transfer finality evidence did not match expected operation'
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('does not query another business or integration scope', async () => {
    const query = vi.fn(async () => ({ rows: [{ outcome: 'applied' }] }));
    const adapter = createDurableOutflowStore({
      execute: query,
      expectedSystemId: '7685292944002592802',
      businessId: scopedIdentity.businessId,
      integrationId: scopedIdentity.integrationId,
    });

    await expect(
      adapter.compareAndSetTerminal({
        expected: { ...expectedOperation, businessId: 'business-foreign' },
        evidence: { ...terminalEvidence, businessId: 'business-foreign' },
        terminalStatus: 'succeeded',
      })
    ).rejects.toThrow('Outgoing transfer finality scope did not match store');
    expect(query).not.toHaveBeenCalled();
  });

  it('exports the exact direct-executor statements and parameter counts', () => {
    expect(PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS.readExpected.parameters).toBe(
      5
    );
    expect(PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS.compareAndSet.parameters).toBe(
      12
    );
  });
});

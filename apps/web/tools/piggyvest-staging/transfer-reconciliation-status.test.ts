import { describe, expect, it, vi } from 'vitest';
import type { ExpectedOutflowOperation } from './transfer-reconciliation';
import {
  createConfiguredTransactionStatusRunner,
  reconcileTransactionStatus,
} from './transfer-reconciliation-status';

const submittedOperation: ExpectedOutflowOperation = {
  reference: 'synthetic-outflow-001',
  amountKobo: 500_000,
  currency: 'NGN',
  sourceWalletId: 'source-wallet-001',
  destinationWalletId: 'destination-wallet-001',
  direction: 'bank',
  providerCustomerId: 'provider-customer-001',
  businessId: 'business-001',
  integrationId: 'integration-001',
  status: 'submitted',
};

describe('reconcileTransactionStatus', () => {
  it('keeps a pending TSQ response pending without submitting another transfer', async () => {
    const query = vi.fn(async () => ({
      reference: 'synthetic-outflow-001',
      status: 'pending',
      amount: 500_000,
      recipient: '0123456789',
      bank: 'GTBank',
      created_at: '2026-09-26T12:00:00Z',
    }));

    await expect(
      reconcileTransactionStatus({ expected: submittedOperation, query })
    ).resolves.toEqual({ outcome: 'pending' });
    expect(query).toHaveBeenCalledWith({
      reference: 'synthetic-outflow-001',
      walletId: 'source-wallet-001',
    });
  });

  it('does not settle a TSQ success without documented currency source and destination evidence', async () => {
    const query = vi.fn(async () => ({
      reference: 'synthetic-outflow-001',
      status: 'success',
      amount: 500_000,
      recipient: '0123456789',
      bank: 'GTBank',
      created_at: '2026-09-26T12:00:00Z',
    }));

    await expect(
      reconcileTransactionStatus({ expected: submittedOperation, query })
    ).resolves.toEqual({
      outcome: 'unresolved',
      reason: 'tsq-missing-identity',
    });
  });

  it('keeps malformed TSQ data unknown before any terminal decision', async () => {
    const query = vi.fn(async () => ({
      reference: 'synthetic-outflow-001',
      status: 'success',
      amount: '500000',
    }));

    await expect(
      reconcileTransactionStatus({ expected: submittedOperation, query })
    ).resolves.toEqual({ outcome: 'unknown' });
  });

  it('keeps an ambiguous TSQ error unknown without retrying a transfer POST', async () => {
    const query = vi.fn(async () => {
      throw new Error('synthetic timeout');
    });

    await expect(
      reconcileTransactionStatus({ expected: submittedOperation, query })
    ).resolves.toEqual({ outcome: 'unknown' });
  });
});

describe('configured TSQ runner', () => {
  it('refuses to poll when staging credentials are not configured', async () => {
    const query = vi.fn();
    expect(() =>
      createConfiguredTransactionStatusRunner({
        expectedSystemId: '123456789',
        businessId: 'business-001',
        integrationId: 'integration-001',
        query,
        stagingConfig: {
          apiBaseUrl: 'https://staging.piggyvest.business',
          apiSecret: '',
          expectedBusinessId: 'business-001',
        },
      })
    ).toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a staging configuration for another provider business before polling', () => {
    const query = vi.fn();

    expect(() =>
      createConfiguredTransactionStatusRunner({
        expectedSystemId: '123456789',
        businessId: 'business-001',
        integrationId: 'integration-001',
        query,
        stagingConfig: {
          apiBaseUrl: 'https://staging.piggyvest.business',
          apiSecret: 'staging-token',
          expectedBusinessId: 'business-foreign',
        },
      })
    ).toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('bounds TSQ to one exact submitted operation and cannot CAS incomplete success evidence', async () => {
    const query = vi.fn(async () => ({
      reference: 'synthetic-outflow-001',
      status: 'success',
      amount: 500_000,
      recipient: '0123456789',
      bank: 'GTBank',
      created_at: '2026-09-26T12:00:00Z',
    }));
    const findExpected = vi.fn(async () => ({
      ...submittedOperation,
      customerId: 'c0065070-dc32-45d2-9c01-871a27abfd10',
    }));
    const compareAndSetTerminal = vi.fn();
    const runner = createConfiguredTransactionStatusRunner({
      expectedSystemId: '123456789',
      businessId: 'business-001',
      integrationId: 'integration-001',
      query,
      stagingConfig: {
        apiBaseUrl: 'https://staging.piggyvest.business',
        apiSecret: 'staging-token',
        expectedBusinessId: 'business-001',
      },
    });

    await expect(
      runner.reconcile({
        findExpected,
        compareAndSetTerminal,
        reference: 'synthetic-outflow-001',
        customerId: 'c0065070-dc32-45d2-9c01-871a27abfd10',
        providerCustomerId: 'provider-customer-001',
      })
    ).resolves.toEqual({
      outcome: 'unresolved',
      reason: 'tsq-missing-identity',
    });
    expect(findExpected).toHaveBeenCalledWith({
      reference: 'synthetic-outflow-001',
      providerCustomerId: 'provider-customer-001',
    });
    expect(compareAndSetTerminal).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith({
      reference: 'synthetic-outflow-001',
      walletId: 'source-wallet-001',
    });
  });

  it.each([
    {
      name: 'reference',
      expected: { reference: 'synthetic-outflow-foreign' },
    },
    {
      name: 'customer',
      expected: { customerId: '6f0f8180-908e-4d02-bc9f-120411e386f0' },
    },
  ])('refuses a returned $name scope before reading TSQ or CASing', async ({
    expected,
  }) => {
    const query = vi.fn();
    const findExpected = vi.fn(async () => ({
      ...submittedOperation,
      customerId: 'c0065070-dc32-45d2-9c01-871a27abfd10',
      ...expected,
    }));
    const compareAndSetTerminal = vi.fn();
    const runner = createConfiguredTransactionStatusRunner({
      expectedSystemId: '123456789',
      businessId: 'business-001',
      integrationId: 'integration-001',
      query,
      stagingConfig: {
        apiBaseUrl: 'https://staging.piggyvest.business',
        apiSecret: 'staging-token',
        expectedBusinessId: 'business-001',
      },
    });

    await expect(
      runner.reconcile({
        findExpected,
        compareAndSetTerminal,
        reference: 'synthetic-outflow-001',
        customerId: 'c0065070-dc32-45d2-9c01-871a27abfd10',
        providerCustomerId: 'provider-customer-001',
      })
    ).resolves.toEqual({
      outcome: 'unresolved',
      reason: 'outbox-not-submitted',
    });
    expect(query).not.toHaveBeenCalled();
    expect(compareAndSetTerminal).not.toHaveBeenCalled();
  });

  it('CASes complete terminal TSQ evidence only after requested customer and reference match', async () => {
    const query = vi.fn(async () => ({
      reference: 'synthetic-outflow-001',
      status: 'success',
      amount: 500_000,
      recipient: '0123456789',
      bank: 'GTBank',
      created_at: '2026-09-26T12:00:00Z',
      customerId: 'c0065070-dc32-45d2-9c01-871a27abfd10',
      currency: 'NGN',
      sourceWalletId: 'source-wallet-001',
      destinationWalletId: 'destination-wallet-001',
      direction: 'bank',
      providerCustomerId: 'provider-customer-001',
      businessId: 'business-001',
      integrationId: 'integration-001',
      providerTransactionId: 'provider-transaction-001',
    }));
    const findExpected = vi.fn(async () => ({
      ...submittedOperation,
      customerId: 'c0065070-dc32-45d2-9c01-871a27abfd10',
    }));
    const compareAndSetTerminal = vi.fn(async () => 'applied' as const);
    const runner = createConfiguredTransactionStatusRunner({
      expectedSystemId: '123456789',
      businessId: 'business-001',
      integrationId: 'integration-001',
      query,
      stagingConfig: {
        apiBaseUrl: 'https://staging.piggyvest.business',
        apiSecret: 'staging-token',
        expectedBusinessId: 'business-001',
      },
    });

    await expect(
      runner.reconcile({
        findExpected,
        compareAndSetTerminal,
        reference: 'synthetic-outflow-001',
        customerId: 'c0065070-dc32-45d2-9c01-871a27abfd10',
        providerCustomerId: 'provider-customer-001',
      })
    ).resolves.toEqual({ outcome: 'applied', status: 'succeeded' });
    expect(compareAndSetTerminal).toHaveBeenCalledExactlyOnceWith({
      expected: submittedOperation,
      evidence: expect.objectContaining({
        providerTransactionId: 'provider-transaction-001',
      }),
      terminalStatus: 'succeeded',
    });
  });
});

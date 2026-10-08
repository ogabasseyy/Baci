import { describe, expect, it, vi } from 'vitest';
import { primaryWalletCardFundingFixture as fixture } from './primary-wallet-card-funding.test-fixture';
import { createPrimaryWalletCardFundingConnection } from './primary-wallet-card-funding-connection';

const scope = {
  environment: fixture.reservation.environment,
  integrationId: fixture.reservation.integrationId,
  merchantId: fixture.reservation.merchantId,
  customerId: fixture.reservation.customerId,
};

function setup() {
  const dependencies = {
    readReservation: vi.fn().mockResolvedValue(fixture.reservation),
    verifyCollection: vi.fn().mockResolvedValue(fixture.collection),
    verifyTransfer: vi.fn().mockResolvedValue(fixture.transfer),
    settleVerifiedCustody: vi.fn().mockResolvedValue('credited'),
  };
  return {
    dependencies,
    refresh: createPrimaryWalletCardFundingConnection(scope, dependencies),
  };
}

describe('primary wallet card funding connection', () => {
  it('does not credit the wallet when Paystack succeeds but PiggyVest custody is absent', async () => {
    const { dependencies, refresh } = setup();
    dependencies.verifyTransfer.mockResolvedValue(null);
    expect(await refresh(fixture.reservation.operationId)).toEqual({
      status: 'custody_pending',
    });
    expect(dependencies.settleVerifiedCustody).not.toHaveBeenCalled();
  });

  it('does not verify a transfer or credit while collection remains pending', async () => {
    const { dependencies, refresh } = setup();
    dependencies.verifyCollection.mockResolvedValue({ outcome: 'pending' });
    expect(await refresh(fixture.reservation.operationId)).toEqual({
      status: 'collection_pending',
    });
    expect(dependencies.verifyTransfer).not.toHaveBeenCalled();
    expect(dependencies.settleVerifiedCustody).not.toHaveBeenCalled();
  });

  it.each([
    'environment',
    'integrationId',
    'merchantId',
    'customerId',
    'operationId',
  ])('rejects a reservation outside trusted %s before verification', async (field) => {
    const { dependencies, refresh } = setup();
    dependencies.readReservation.mockResolvedValue({
      ...fixture.reservation,
      [field]:
        field === 'environment'
          ? 'production'
          : '10000000-0000-4000-8000-000000000009',
    });
    expect(await refresh(fixture.reservation.operationId)).toEqual({
      status: 'reconciliation_required',
    });
    expect(dependencies.verifyCollection).not.toHaveBeenCalled();
    expect(dependencies.settleVerifiedCustody).not.toHaveBeenCalled();
  });

  it('returns completed only after durable custody acknowledgement', async () => {
    const { dependencies, refresh } = setup();
    expect(await refresh(fixture.reservation.operationId)).toEqual({
      status: 'completed',
    });
    expect(dependencies.settleVerifiedCustody).toHaveBeenCalledWith({
      ...fixture.reservation,
      collectionTransactionId: '12345',
      transferTransactionId: 'fixture-transfer-id',
    });
  });

  it('accepts an already committed replay without exposing evidence', async () => {
    const { dependencies, refresh } = setup();
    dependencies.settleVerifiedCustody.mockResolvedValue('duplicate');
    expect(await refresh(fixture.reservation.operationId)).toEqual({
      status: 'completed',
    });
  });

  it.each([
    'conflict',
    'submitted',
    null,
  ])('rejects a non-durable or conflicting acknowledgement %s', async (acknowledgement) => {
    const { dependencies, refresh } = setup();
    dependencies.settleVerifiedCustody.mockResolvedValue(acknowledgement);
    expect(await refresh(fixture.reservation.operationId)).toEqual({
      status: 'reconciliation_required',
    });
  });

  it('does not report completed when settlement acknowledgement is lost', async () => {
    const { dependencies, refresh } = setup();
    dependencies.settleVerifiedCustody.mockRejectedValue(
      new Error('private provider details')
    );
    expect(await refresh(fixture.reservation.operationId)).toEqual({
      status: 'reconciliation_required',
    });
  });

  it('does not query storage for an invalid operation identifier', async () => {
    const { dependencies, refresh } = setup();
    expect(await refresh('invalid')).toEqual({
      status: 'reconciliation_required',
    });
    expect(dependencies.readReservation).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkWalletPayment,
  payFromWallet,
  readWalletPayPinBinding,
  reconcileWalletPayReferences,
  refundWalletPayment,
} from './wallet-pay-service';

vi.mock('server-only', () => ({}));

const OP = '5b0f2a40-1c1d-4e6b-9a51-2f3c4d5e6f70';
const ports = vi.hoisted(() => ({
  customer: {
    readIssued: vi.fn(),
    reserve: vi.fn(),
    manage: vi.fn(),
    readStatus: vi.fn(),
    issue: vi.fn(),
  },
  worker: {
    readOwedRefund: vi.fn(),
    manageRefund: vi.fn(),
    claim: vi.fn(),
    finish: vi.fn(),
    listWork: vi.fn(),
  },
  evidence: {
    loadDispatched: vi.fn(),
    findByReference: vi.fn(),
    settle: vi.fn(),
    release: vi.fn(),
  },
  queryProvider: vi.fn(),
  retrieveWallet: vi.fn(),
  lookupTransfer: vi.fn(),
  transfer: vi.fn(),
}));
vi.mock('./wallet-pay-ports', () => ({
  createWalletPayPorts: () => ({
    ...ports,
    customerStore: () => ports.customer,
  }),
}));

const runtime = { collectionWalletId: 'collection-wallet' } as never;
const scope = {};
const reservation = {
  operationId: OP,
  purpose: 'imei_check',
  purchaseRef: 'lookup-1',
  amountKobo: 100000,
  sourceWalletId: 'main-wallet',
  destinationWalletId: 'collection-wallet',
  reference: `pvb-pay-${OP}`,
  businessId: 'business-1',
  providerCustomerId: 'customer-1',
};
const status = (state: string, fulfilment = 'awaiting') => ({
  state,
  fulfilment,
  purpose: 'imei_check',
  purchaseRef: 'lookup-1',
  amountKobo: 100000,
  refund: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  ports.retrieveWallet.mockImplementation(async (id: string) => ({
    id,
    ...(id === 'main-wallet' ? { api_customer_id: 'customer-1' } : {}),
    business_id: 'business-1',
    currency: 'NGN',
    status: 'active',
    is_frozen: false,
    has_an_active_lien: false,
    balance: 500000,
  }));
  ports.customer.manage.mockResolvedValue(true);
  ports.transfer.mockResolvedValue({ accepted: true });
});

describe('readWalletPayPinBinding', () => {
  it('builds the PIN binding from the issued row, never from the client', async () => {
    ports.customer.readIssued.mockResolvedValue({
      operationId: OP,
      purpose: 'vtu',
      purchaseRef: 'vtu-1',
      amountKobo: 5000,
      pinKeySha256: 'a'.repeat(64),
    });
    await expect(
      readWalletPayPinBinding({ runtime, scope, operationId: OP })
    ).resolves.toEqual({
      binding: {
        purpose: 'wallet_pay',
        amountKobo: 5000,
        idempotencyKeySha256: 'a'.repeat(64),
      },
      purchase: { purpose: 'vtu', purchaseRef: 'vtu-1' },
    });
  });

  it('gives no binding for an unknown or expired id (no proof slot is used)', async () => {
    ports.customer.readIssued.mockResolvedValue(null);
    await expect(
      readWalletPayPinBinding({ runtime, scope, operationId: OP })
    ).resolves.toBeNull();
  });
});

describe('payFromWallet', () => {
  it('sends once and reports confirmed when PiggyVest already shows it settled', async () => {
    ports.customer.reserve.mockResolvedValue({
      status: 'claimed',
      reservation,
    });
    ports.evidence.loadDispatched.mockResolvedValue(reservation);
    ports.queryProvider.mockResolvedValue({
      status: true,
      data: {
        id: 'txn-1',
        reference: 'PVB01',
        third_party_reference: `pvb-pay-${OP}`,
        internal_reference: 'txn-1',
        status: 'successful',
        amount: 100000,
        fee: 0,
        customer_id: 'business-1',
        source_wallet: 'main-wallet',
        destination_wallet: 'collection-wallet',
      },
    });
    ports.evidence.settle.mockResolvedValue('confirmed');
    await expect(
      payFromWallet({
        runtime,
        scope,
        operationId: OP,
        pinProof: 'b'.repeat(64),
      })
    ).resolves.toEqual({ status: 'confirmed' });
    expect(ports.transfer).toHaveBeenCalledTimes(1);
    expect(ports.customer.reserve).toHaveBeenCalledWith(OP, 'b'.repeat(64));
  });

  it('moves nothing when the PIN proof is refused', async () => {
    ports.customer.reserve.mockResolvedValue({
      status: 'pin_refused',
      reason: 'missing',
    });
    await expect(
      payFromWallet({ runtime, scope, operationId: OP, pinProof: '' })
    ).resolves.toEqual({
      status: 'pin_refused',
      reason: 'missing',
    });
    expect(ports.transfer).not.toHaveBeenCalled();
  });

  it('stays pending when reconciliation cannot conclude yet', async () => {
    ports.customer.reserve.mockResolvedValue({
      status: 'claimed',
      reservation,
    });
    ports.evidence.loadDispatched.mockRejectedValue(new Error('db down'));
    await expect(
      payFromWallet({
        runtime,
        scope,
        operationId: OP,
        pinProof: 'b'.repeat(64),
      })
    ).resolves.toEqual({ status: 'pending' });
  });
});

describe('checkWalletPayment', () => {
  it('only reads and reconciles; it never sends', async () => {
    ports.customer.readStatus
      .mockResolvedValueOnce(status('dispatched'))
      .mockResolvedValueOnce(status('confirmed'));
    ports.evidence.loadDispatched.mockResolvedValue(null);
    await expect(
      checkWalletPayment({ runtime, scope, operationId: OP })
    ).resolves.toMatchObject({
      state: 'confirmed',
    });
    expect(ports.transfer).not.toHaveBeenCalled();
  });

  it('releases a stale reservation that was never sent', async () => {
    ports.customer.readStatus
      .mockResolvedValueOnce(status('reserved'))
      .mockResolvedValueOnce(status('released'));
    await expect(
      checkWalletPayment({ runtime, scope, operationId: OP })
    ).resolves.toMatchObject({
      state: 'released',
    });
    expect(ports.customer.manage).toHaveBeenCalledWith(OP, 'cancel_stale');
  });

  it('answers null for an id that is not this customer’s', async () => {
    ports.customer.readStatus.mockResolvedValue(null);
    await expect(
      checkWalletPayment({ runtime, scope, operationId: OP })
    ).resolves.toBeNull();
  });
});

describe('refundWalletPayment', () => {
  it('reports none when nothing is owed and sends nothing', async () => {
    ports.worker.readOwedRefund.mockResolvedValue(null);
    ports.evidence.loadDispatched.mockResolvedValue(null);
    await expect(refundWalletPayment({ runtime, paymentId: OP })).resolves.toBe(
      'none'
    );
    expect(ports.transfer).not.toHaveBeenCalled();
  });
});

describe('reconcileWalletPayReferences', () => {
  it('is unmatched for references that are not wallet pay', async () => {
    ports.evidence.findByReference.mockResolvedValue(null);
    await expect(
      reconcileWalletPayReferences({ runtime, references: ['pvb-save-x'] })
    ).resolves.toBe('unmatched');
  });

  it('reconciles the first wallet pay reference it finds', async () => {
    ports.evidence.findByReference.mockResolvedValue({
      kind: 'refund',
      operationId: OP,
      reference: `pvb-refund-${OP}-1`,
      settled: false,
    });
    ports.evidence.loadDispatched.mockResolvedValue(null);
    await expect(
      reconcileWalletPayReferences({
        runtime,
        references: [`pvb-refund-${OP}`],
      })
    ).resolves.toBe('pending');
    // The exact attempt the webhook named is reconciled.
    expect(ports.evidence.loadDispatched).toHaveBeenCalledWith(
      'refund',
      OP,
      `pvb-refund-${OP}-1`
    );
  });

  it('acknowledges a webhook for a transfer the status path already settled', async () => {
    ports.evidence.findByReference.mockResolvedValue({
      kind: 'payment',
      operationId: OP,
      reference: `pvb-pay-${OP}`,
      settled: true,
    });
    await expect(
      reconcileWalletPayReferences({ runtime, references: [`pvb-pay-${OP}`] })
    ).resolves.toBe('confirmed');
    expect(ports.queryProvider).not.toHaveBeenCalled();
  });
});

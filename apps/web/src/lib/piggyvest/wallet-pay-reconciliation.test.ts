import { describe, expect, it, vi } from 'vitest';
import { reconcileWalletPayTransfer } from './wallet-pay-reconciliation';

vi.mock('server-only', () => ({}));

const OP = '5b0f2a40-1c1d-4e6b-9a51-2f3c4d5e6f70';
const payment = {
  operationId: OP,
  purpose: 'vtu',
  purchaseRef: 'vtu-1',
  amountKobo: 100000,
  sourceWalletId: 'main-wallet',
  destinationWalletId: 'collection-wallet',
  reference: `pvb-pay-${OP}`,
  businessId: 'business-1',
  providerCustomerId: 'customer-1',
};
function record(status: string, fee = 0) {
  return {
    status: true,
    data: {
      id: 'txn-1',
      reference: 'PVB01',
      third_party_reference: `pvb-pay-${OP}`,
      internal_reference: 'txn-1',
      status,
      amount: 100000,
      fee,
      customer_id: 'business-1',
      source_wallet: 'main-wallet',
      destination_wallet: 'collection-wallet',
    },
  };
}
function ports(response: unknown, overrides = {}) {
  return {
    loadDispatched: vi.fn(async () => payment as unknown),
    queryProvider: vi.fn(async () => response),
    settle: vi.fn(async () => 'confirmed' as const),
    release: vi.fn(async () => 'released' as const),
    ...overrides,
  };
}

describe('reconcileWalletPayTransfer', () => {
  it('settles a verified success once, querying the sender wallet by our reference', async () => {
    const p = ports(record('successful'));
    await expect(
      reconcileWalletPayTransfer({ kind: 'payment', operationId: OP }, p)
    ).resolves.toBe('confirmed');
    expect(p.queryProvider).toHaveBeenCalledWith({
      reference: `pvb-pay-${OP}`,
      walletId: 'main-wallet',
    });
    expect(p.settle).toHaveBeenCalledWith(
      'payment',
      expect.objectContaining({ feeKobo: 0 })
    );
    expect(p.release).not.toHaveBeenCalled();
  });

  it('releases on a verified failure', async () => {
    const p = ports(record('failed'));
    await expect(
      reconcileWalletPayTransfer({ kind: 'payment', operationId: OP }, p)
    ).resolves.toBe('released');
    expect(p.settle).not.toHaveBeenCalled();
  });

  it('stays pending on an unverified or pending record and changes nothing', async () => {
    for (const response of [record('pending'), { status: true }, null]) {
      const p = ports(response);
      await expect(
        reconcileWalletPayTransfer({ kind: 'payment', operationId: OP }, p)
      ).resolves.toBe('pending');
      expect(p.settle).not.toHaveBeenCalled();
      expect(p.release).not.toHaveBeenCalled();
    }
  });

  it('stays pending when nothing is dispatched or the provider read throws', async () => {
    const none = ports(record('successful'), {
      loadDispatched: vi.fn(async () => null),
    });
    await expect(
      reconcileWalletPayTransfer({ kind: 'payment', operationId: OP }, none)
    ).resolves.toBe('pending');
    const down = ports(null, {
      queryProvider: vi.fn(async () => Promise.reject(new Error('down'))),
    });
    await expect(
      reconcileWalletPayTransfer({ kind: 'payment', operationId: OP }, down)
    ).resolves.toBe('pending');
  });

  it('bugfix: rethrows a reconciliation exception for the drain, so the run counts it as failed (Codex P2)', async () => {
    const down = ports(null, {
      queryProvider: vi.fn(async () => Promise.reject(new Error('down'))),
    });
    await expect(
      reconcileWalletPayTransfer(
        { kind: 'payment', operationId: OP, surfaceErrors: true },
        down
      )
    ).rejects.toThrow('down');
    const settleFails = ports(record('successful'), {
      settle: vi.fn(async () => Promise.reject(new Error('db'))),
    });
    await expect(
      reconcileWalletPayTransfer(
        { kind: 'payment', operationId: OP, surfaceErrors: true },
        settleFails
      )
    ).rejects.toThrow('db');
  });

  it('maps the database answer for a fee, a duplicate payment and a deferred late success', async () => {
    const cases = [
      ['needs_review', 'needs_review'],
      ['refunding', 'refunding'],
      ['deferred', 'pending'],
      ['duplicate', 'confirmed'],
      ['conflict', 'pending'],
    ] as const;
    for (const [answer, expected] of cases) {
      const p = ports(record('successful', 5000), {
        settle: vi.fn(async () => answer),
      });
      await expect(
        reconcileWalletPayTransfer({ kind: 'payment', operationId: OP }, p)
      ).resolves.toBe(expected);
    }
  });

  it('reconciles a refund by the same proof', async () => {
    const refund = {
      refundId: '6c1f3b51-2d2e-4f7c-8b62-3a4d5e6f7081',
      operationId: OP,
      amountKobo: 100000,
      sourceWalletId: 'collection-wallet',
      destinationWalletId: 'main-wallet',
      reference: `pvb-refund-${OP}`,
      businessId: 'business-1',
      providerCustomerId: 'customer-1',
    };
    const body = record('successful');
    body.data = {
      ...body.data,
      third_party_reference: `pvb-refund-${OP}`,
      source_wallet: 'collection-wallet',
      destination_wallet: 'main-wallet',
    };
    const p = ports(body, { loadDispatched: vi.fn(async () => refund) });
    await expect(
      reconcileWalletPayTransfer({ kind: 'refund', operationId: OP }, p)
    ).resolves.toBe('confirmed');
    expect(p.queryProvider).toHaveBeenCalledWith({
      reference: `pvb-refund-${OP}`,
      walletId: 'collection-wallet',
    });
    expect(p.settle).toHaveBeenCalledWith('refund', expect.any(Object));
  });
  it('holds a failed record that charged a fee for review instead of releasing it', async () => {
    const p = ports(record('failed', 5000), {
      release: vi.fn(async () => 'needs_review'),
    });
    await expect(
      reconcileWalletPayTransfer({ kind: 'payment', operationId: OP }, p)
    ).resolves.toBe('needs_review');
  });
});

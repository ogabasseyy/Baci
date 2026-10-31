import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OTHER_WALLET_ID,
  PAYOUT_WALLET_ID,
  routedWallet,
} from './primary-wallet-onboarding.test-fixture';
import { recoverPrimaryWalletRouting } from './primary-wallet-routing-recovery';
import { PRIMARY_WALLET_STATEMENTS } from './primary-wallet-statements';

const mocks = vi.hoisted(() => ({ alert: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./webhook-alerts', () => ({ emitPiggyvestWebhookAlert: mocks.alert }));

const scope = {
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  customerId: 'e648eb14-928a-427b-9719-b105f6d4b8b4',
  userId: 'f4f01e61-691f-494a-a895-872f17f8e55e',
  integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
  businessId: 'business-fixture',
  environment: 'production' as const,
};
const pending = {
  providerCustomerId: 'customer-fixture',
  providerWalletId: 'wallet-fixture',
};

function fixture(stored: typeof pending | null = pending) {
  const execute = vi.fn(async (statement: string) => ({
    rows: [
      {
        result:
          statement === PRIMARY_WALLET_STATEMENTS.readRouting ? stored : true,
      },
    ],
  }));
  const retrieveWallet = vi.fn().mockResolvedValue(routedWallet());
  return {
    execute,
    retrieveWallet,
    run: () =>
      recoverPrimaryWalletRouting({
        scope,
        execute,
        payoutWalletId: PAYOUT_WALLET_ID,
        retrieveWallet,
      }),
  };
}

const resolveCalls = (execute: ReturnType<typeof fixture>['execute']) =>
  execute.mock.calls.filter(
    ([statement]) => statement === PRIMARY_WALLET_STATEMENTS.resolveRouting
  );

beforeEach(() => vi.clearAllMocks());

describe('primary wallet routing recovery', () => {
  it('does nothing, and reads nothing from the provider, without a routing-pending wallet', async () => {
    const input = fixture(null);
    expect(await input.run()).toBe('none');
    expect(input.retrieveWallet).not.toHaveBeenCalled();
    expect(resolveCalls(input.execute)).toHaveLength(0);
  });

  it('keeps waiting while the readback fails, then promotes once it proves the routing, with no new customer', async () => {
    const input = fixture();
    input.retrieveWallet
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(routedWallet({ interest_payout_wallet: null }))
      .mockResolvedValueOnce(routedWallet());
    expect(await input.run()).toBe('pending');
    expect(await input.run()).toBe('pending');
    expect(resolveCalls(input.execute)).toHaveLength(0);
    expect(await input.run()).toBe('promoted');
    expect(input.retrieveWallet).toHaveBeenNthCalledWith(3, 'wallet-fixture');
    expect(resolveCalls(input.execute)).toEqual([
      [
        PRIMARY_WALLET_STATEMENTS.resolveRouting,
        [JSON.stringify(scope), JSON.stringify(pending), 'true'],
      ],
    ]);
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('blocks a wallet whose readback names another payout wallet, and alerts without identifiers', async () => {
    const input = fixture();
    input.retrieveWallet.mockResolvedValue(
      routedWallet({ interest_payout_wallet: OTHER_WALLET_ID })
    );
    expect(await input.run()).toBe('rejected');
    expect(resolveCalls(input.execute)).toEqual([
      [
        PRIMARY_WALLET_STATEMENTS.resolveRouting,
        [JSON.stringify(scope), JSON.stringify(pending), 'false'],
      ],
    ]);
    expect(mocks.alert).toHaveBeenCalledExactlyOnceWith(
      'PIGGYVEST_PRIMARY_ROUTING_NEEDS_REVIEW',
      expect.any(Object)
    );
    const alerted = JSON.stringify(mocks.alert.mock.calls);
    for (const secret of [
      OTHER_WALLET_ID,
      PAYOUT_WALLET_ID,
      'wallet-fixture',
      'customer-fixture',
      scope.customerId,
    ])
      expect(alerted).not.toContain(secret);
  });

  it('does not alert or claim a resolution another request already made', async () => {
    const input = fixture();
    input.retrieveWallet.mockResolvedValue(
      routedWallet({ interest_payout_wallet: OTHER_WALLET_ID })
    );
    input.execute.mockImplementation(async (statement: string) => ({
      rows: [
        {
          result:
            statement === PRIMARY_WALLET_STATEMENTS.readRouting
              ? pending
              : false,
        },
      ],
    }));
    expect(await input.run()).toBe('pending');
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it.each([
    ['the pending read fails', PRIMARY_WALLET_STATEMENTS.readRouting],
    ['the resolution fails', PRIMARY_WALLET_STATEMENTS.resolveRouting],
  ])('reports unavailable when %s', async (_label, failing) => {
    const input = fixture();
    const original = input.execute.getMockImplementation();
    input.execute.mockImplementation(async (statement: string) => {
      if (statement === failing) throw new Error('private database detail');
      return original ? original(statement) : { rows: [] };
    });
    expect(await input.run()).toBe('unavailable');
  });

  it('refuses a malformed payout wallet before reading anything', async () => {
    const input = fixture();
    expect(
      await recoverPrimaryWalletRouting({
        scope,
        execute: input.execute,
        payoutWalletId: 'not-a-wallet-id',
        retrieveWallet: input.retrieveWallet,
      })
    ).toBe('unavailable');
    expect(input.execute).not.toHaveBeenCalled();
    expect(input.retrieveWallet).not.toHaveBeenCalled();
  });
});

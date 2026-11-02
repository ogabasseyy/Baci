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
const INTENT_ID = '00000000-0000-4000-8000-0000000000aa';
// What read_onboarding_routing returns: the kept ids and the payout wallet
// the customer was created with.
const pending = {
  intentId: INTENT_ID,
  providerCustomerId: 'customer-fixture',
  providerWalletId: 'wallet-fixture',
  payoutWalletId: PAYOUT_WALLET_ID,
};
// What resolve_onboarding_routing is given: the kept ids only.
const proof = {
  providerCustomerId: 'customer-fixture',
  providerWalletId: 'wallet-fixture',
};

function fixture(stored: Record<string, string> | null = pending) {
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
    run: () => recoverPrimaryWalletRouting({ scope, execute, retrieveWallet }),
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
        [JSON.stringify(scope), JSON.stringify(proof), 'true', null],
      ],
    ]);
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('checks against the payout wallet stored at creation, so a later configuration change cannot reject a routed wallet', async () => {
    // Created with OTHER_WALLET_ID (an earlier configuration); today's
    // setting is irrelevant: the stored value is the routing to prove.
    const input = fixture({ ...pending, payoutWalletId: OTHER_WALLET_ID });
    input.retrieveWallet.mockResolvedValue(
      routedWallet({ interest_payout_wallet: OTHER_WALLET_ID })
    );
    expect(await input.run()).toBe('promoted');
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('blocks a wallet whose readback names another payout wallet, and alerts with only the intent id', async () => {
    const input = fixture();
    input.retrieveWallet.mockResolvedValue(
      routedWallet({ interest_payout_wallet: OTHER_WALLET_ID })
    );
    expect(await input.run()).toBe('rejected');
    expect(resolveCalls(input.execute)).toEqual([
      [
        PRIMARY_WALLET_STATEMENTS.resolveRouting,
        [JSON.stringify(scope), JSON.stringify(proof), 'false', 'routing'],
      ],
    ]);
    expect(mocks.alert).toHaveBeenCalledExactlyOnceWith(
      'PIGGYVEST_PRIMARY_ROUTING_NEEDS_REVIEW',
      expect.objectContaining({ operationId: INTENT_ID })
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

  it('keeps an identity mismatch as an ownership hold when resolving routing', async () => {
    const input = fixture();
    input.retrieveWallet.mockResolvedValue(
      routedWallet({ api_customer_id: 'another-customer' })
    );
    expect(await input.run()).toBe('rejected');
    expect(resolveCalls(input.execute)).toEqual([
      [
        PRIMARY_WALLET_STATEMENTS.resolveRouting,
        [JSON.stringify(scope), JSON.stringify(proof), 'false', null],
      ],
    ]);
    expect(mocks.alert).toHaveBeenCalledExactlyOnceWith(
      'PIGGYVEST_PRIMARY_ROUTING_NEEDS_REVIEW',
      expect.objectContaining({ operationId: INTENT_ID })
    );
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

  it('refuses a malformed stored record without reading the provider', async () => {
    const input = fixture({ ...pending, payoutWalletId: 'not-a-wallet-id' });
    expect(await input.run()).toBe('unavailable');
    expect(input.retrieveWallet).not.toHaveBeenCalled();
    expect(resolveCalls(input.execute)).toHaveLength(0);
  });
});

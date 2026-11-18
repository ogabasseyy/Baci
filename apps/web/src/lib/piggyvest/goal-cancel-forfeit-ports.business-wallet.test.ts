import { beforeEach, expect, it, vi } from 'vitest';
import { forfeitDriverPorts } from './goal-cancel-forfeit-ports';

// Owner decision 2026-11-18: forfeited goal interest goes to Ogabassey's
// business-owned interest payout wallet, which PiggyVest reports with no API
// customer (api_customer_id null, passed on by the wallet reader as absent).
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock('./wallets', () => ({ retrievePiggyvestWallet: mocks.retrieve }));
vi.mock('./transfers', () => ({ transferToWallet: vi.fn() }));
vi.mock('./primary-wallet-savings-transfer-lookup', () => ({
  lookupSavingsTransferReference: vi.fn(),
}));
vi.mock('./goal-cancel-forfeit-reconciliation', () => ({
  runGoalCancelForfeitReconciliation: vi.fn(),
}));
vi.mock('./webhook-alerts', () => ({ emitPiggyvestWebhookAlert: vi.fn() }));

const forfeit = {
  operationId: '77777777-7777-4777-8777-777777777777',
  goalId: '55555555-5555-4555-8555-555555555555',
  amountKobo: 12000,
  sourceWalletId: 'goal-wallet',
  destinationWalletId: 'interest-wallet',
  reference: 'pvb-forfeit-55555555-5555-4555-8555-555555555555',
  businessId: 'business',
  providerCustomerId: 'customer',
};
const businessWallet = {
  id: 'interest-wallet',
  business_id: 'business',
  api_customer_id: undefined,
  currency: 'NGN',
  status: 'active',
};
const goalWallet = {
  id: 'goal-wallet',
  business_id: 'business',
  api_customer_id: 'customer',
  currency: 'NGN',
  status: 'active',
  balance: 12000,
};

function ports(
  owner: string | null,
  walletId: string | null = 'interest-wallet'
) {
  return forfeitDriverPorts({
    claim: vi.fn(),
    release: vi.fn(),
    unclaim: vi.fn(),
    markPosting: vi.fn(),
    ackAlert: vi.fn().mockResolvedValue('acked'),
    provider: { token: 'token', baseUrl: 'https://example.test' },
    evidence: null,
    operationId: '66666666-6666-4666-8666-666666666666',
    expectedDestinationWalletId: walletId,
    expectedDestinationOwnerId: owner,
  });
}

function answer(destination: Record<string, unknown>) {
  mocks.retrieve.mockImplementation(async (_provider: unknown, id: string) =>
    id === 'goal-wallet' ? goalWallet : destination
  );
}

beforeEach(() => vi.clearAllMocks());

it('accepts the business-owned interest wallet when the ids and business match and no owner id is set', async () => {
  answer(businessWallet);
  expect(await ports(null).verifyDestination(forfeit)).toBe(true);
  // PiggyVest's raw null (not normalised by a reader) is the same answer.
  answer({ ...businessWallet, api_customer_id: null });
  expect(await ports(null).verifyDestination(forfeit)).toBe(true);
});

it('refuses a business wallet when an owner id is configured', async () => {
  answer(businessWallet);
  expect(await ports('ogabassey').verifyDestination(forfeit)).toBe(false);
});

it('refuses a business wallet in another business', async () => {
  answer({ ...businessWallet, business_id: 'another-business' });
  expect(await ports(null).verifyDestination(forfeit)).toBe(false);
});

it('refuses a business wallet that is inactive or not NGN', async () => {
  for (const wrong of [{ status: 'frozen' }, { currency: 'USD' }]) {
    answer({ ...businessWallet, ...wrong });
    expect(await ports(null).verifyDestination(forfeit)).toBe(false);
  }
});

it('refuses when the database wallet differs from the deployment setting', async () => {
  answer(businessWallet);
  expect(await ports(null, 'another-wallet').verifyDestination(forfeit)).toBe(
    false
  );
  answer({ ...businessWallet, id: 'another-wallet' });
  expect(
    await ports(null, 'another-wallet').verifyDestination({
      ...forfeit,
      destinationWalletId: 'another-wallet',
    })
  ).toBe(true);
  // PiggyVest answering for a different wallet than the one configured.
  answer({ ...businessWallet, id: 'someone-else' });
  expect(await ports(null).verifyDestination(forfeit)).toBe(false);
});

it('refuses when the deployment interest wallet id is missing', async () => {
  answer(businessWallet);
  expect(await ports(null, null).verifyDestination(forfeit)).toBe(false);
});

it("refuses the customer's own goal or main wallet as the destination", async () => {
  // Goal wallet configured as the interest wallet.
  answer(goalWallet);
  expect(
    await ports(null, 'goal-wallet').verifyDestination({
      ...forfeit,
      destinationWalletId: 'goal-wallet',
    })
  ).toBe(false);
  // A wallet owned by the cancelling customer, under either rule.
  answer({ ...businessWallet, api_customer_id: 'customer' });
  expect(await ports(null).verifyDestination(forfeit)).toBe(false);
  expect(await ports('customer').verifyDestination(forfeit)).toBe(false);
});

it('without an owner id, refuses a customer-owned wallet', async () => {
  answer({ ...businessWallet, api_customer_id: 'ogabassey' });
  expect(await ports(null).verifyDestination(forfeit)).toBe(false);
});

it('keeps the customer-owned interest wallet path working', async () => {
  answer({ ...businessWallet, api_customer_id: 'ogabassey' });
  expect(await ports('ogabassey').verifyDestination(forfeit)).toBe(true);
});

it('still checks the goal wallet the interest comes from', async () => {
  mocks.retrieve.mockImplementation(async (_provider: unknown, id: string) =>
    id === 'goal-wallet' ? { ...goalWallet, balance: 100 } : businessWallet
  );
  expect(await ports(null).verifyDestination(forfeit)).toBe(
    'source_unavailable'
  );
});

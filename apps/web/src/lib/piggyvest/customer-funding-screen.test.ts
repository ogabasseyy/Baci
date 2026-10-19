import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
import { createPiggyvestCustomerFundingScreen } from './customer-funding-screen';
import { createFundingScreenFixture as fixture } from './customer-funding-screen.test-fixture';

vi.mock('server-only', () => ({}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps GET as the policy handler without implicit funding work', async () => {
  const test = fixture();
  const response = await createPiggyvestCustomerFundingScreen(test.options).GET(
    new NextRequest(`http://localhost/policy?goalId=${test.identity.goalId}`)
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({
    status: 'draft',
    consent: 'accepted',
  });
  expect(test.fundingExecute).not.toHaveBeenCalled();
  expect(test.fetchImplementation).not.toHaveBeenCalled();
});

it('does not publish accounts after cancellation of the screen request', async () => {
  const test = fixture();
  const controller = new AbortController();
  const provider = test.fetchImplementation.getMockImplementation();
  test.fetchImplementation.mockImplementation(async (...args) => {
    if (!provider) throw new Error('Missing synthetic provider');
    const response = await provider(...args);
    if (String(args[0]).endsWith('/accounts')) controller.abort();
    return response;
  });
  const result = await createPiggyvestCustomerFundingScreen(
    test.options
  ).readScreen(
    new NextRequest(`http://localhost/policy?goalId=${test.identity.goalId}`, {
      signal: controller.signal,
    })
  );
  expect(result).toMatchObject({
    funding: { status: 'unavailable' },
    eligibility: { status: 'unavailable' },
  });
});

it('connects accepted unfunded draft to mapped accounts without activation or spendable balance', async () => {
  const test = fixture();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('No ambient network');
    })
  );
  const result = await test.read();
  expect(result).toMatchObject({
    status: 'ready',
    funding: {
      status: 'ready',
      accounts: [
        {
          accountNumber: '0001234567',
          accountName: 'Synthetic account',
          bankName: 'Synthetic bank',
        },
      ],
    },
    eligibility: {
      status: 'allowed',
      goalId: test.identity.goalId,
      revisionId: test.policy.revisionId,
    },
    progress: { status: 'unavailable' },
  });
  expect(test.fetchImplementation).toHaveBeenCalledTimes(2);
  expect(test.fundingExecute).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(result)).not.toContain('999999999');
  expect(fetch).not.toHaveBeenCalled();
});

it('never turns persisted consent alone into eligibility', async () => {
  const test = fixture();
  test.fundingExecute.mockResolvedValue({ rows: [{ result: null }] });
  expect(await test.read()).toMatchObject({
    eligibility: { status: 'unavailable' },
    funding: { status: 'unavailable' },
  });
  expect(test.fetchImplementation).not.toHaveBeenCalled();
});

it('does not read capability or provider before actual acceptance', async () => {
  const test = fixture();
  test.policy.actorId = null;
  test.policy.acceptedAt = null;
  expect(await test.read()).toMatchObject({
    eligibility: { status: 'unavailable' },
  });
  expect(test.fundingExecute).not.toHaveBeenCalled();
  expect(test.fetchImplementation).not.toHaveBeenCalled();
});

it('authenticates before configuration or storage', async () => {
  const test = fixture();
  test.getUser.mockRejectedValue(new Error('auth unavailable'));
  Object.defineProperty(test.options, 'fundingConfiguration', {
    get() {
      throw new Error('configuration read before auth');
    },
  });
  expect(await test.read()).toEqual({
    environment: 'staging',
    status: 'unauthenticated',
  });
  expect(test.from).not.toHaveBeenCalled();
  expect(test.execute).not.toHaveBeenCalled();
});

it.each([
  'integrationId',
  'expectedBusinessId',
  'actualProjectId',
] as const)('rejects mismatched funding %s before its storage/provider work', async (key) => {
  const test = fixture();
  test.options.fundingConfiguration[key] = 'mismatch';
  expect(await test.read()).toMatchObject({
    eligibility: { status: 'unavailable' },
  });
  expect(test.fundingExecute).not.toHaveBeenCalled();
  expect(test.fetchImplementation).not.toHaveBeenCalled();
});

it('redacts private errors and rejects a different wallet mapping', async () => {
  const test = fixture();
  test.mappingExecute.mockRejectedValue(new Error('private database details'));
  const result = await test.read();
  expect(result).toMatchObject({
    funding: { status: 'unavailable' },
    progress: { status: 'unavailable' },
  });
  expect(JSON.stringify(result)).not.toContain('private');
  expect(test.fetchImplementation).not.toHaveBeenCalled();
});

it('rechecks capability after provider lookup and hides stale account details', async () => {
  const test = fixture();
  test.fundingExecute
    .mockResolvedValueOnce({
      rows: [
        {
          result: {
            policy: test.policy,
            ledgerSnapshot: test.ledgerSnapshot,
            identity: test.identity,
          },
        },
      ],
    })
    .mockResolvedValueOnce({ rows: [{ result: null }] });
  const result = await test.read();
  expect(result).toMatchObject({
    funding: { status: 'unavailable' },
    eligibility: { status: 'unavailable' },
  });
  expect(JSON.stringify(result)).not.toContain('0001234567');
});

it('does not declare funding allowed when the provider has no account yet', async () => {
  const test = fixture();
  test.fetchImplementation.mockImplementation(async (url) =>
    String(url).endsWith('/accounts')
      ? Response.json({ status: true, data: [] })
      : Response.json({
          status: true,
          data: {
            id: test.identity.providerWalletId,
            business_id: 'synthetic-business',
            currency: 'NGN',
            status: 'active',
            balance: 0,
          },
        })
  );
  expect(await test.read()).toMatchObject({
    funding: { status: 'pending' },
    eligibility: { status: 'pending' },
    progress: { status: 'unavailable' },
  });
});

it.each([
  'revision',
  'wallet',
  'actor',
  'duration',
  'terms',
] as const)('rejects post-provider %s drift', async (kind) => {
  const test = fixture();
  const before = {
    policy: structuredClone(test.policy),
    identity: { ...test.identity },
    ledgerSnapshot: test.ledgerSnapshot,
  };
  const after = structuredClone(before);
  if (kind === 'revision') {
    after.policy.revisionId = test.identity.goalId;
    after.policy.command.revisionId = test.identity.goalId;
  }
  if (kind === 'wallet') after.identity.providerWalletId = 'different-wallet';
  if (kind === 'actor') after.policy.actorId = test.identity.goalId;
  if (kind === 'duration') after.policy.durationMonths = 3;
  if (kind === 'terms') after.policy.command.termsHash = 'b'.repeat(64);
  test.fundingExecute
    .mockResolvedValueOnce({ rows: [{ result: before }] })
    .mockResolvedValueOnce({ rows: [{ result: after }] });
  const result = await test.read();
  expect(result).toMatchObject({
    funding: { status: 'unavailable' },
    eligibility: { status: 'unavailable' },
  });
  expect(JSON.stringify(result)).not.toContain('0001234567');
});

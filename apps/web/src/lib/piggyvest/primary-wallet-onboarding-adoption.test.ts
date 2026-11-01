import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onboardingFixture } from './primary-wallet-onboarding.test-fixture';
import {
  judgeCreatedCustomer,
  keepCreatedWalletForReview,
} from './primary-wallet-onboarding-adoption';

vi.mock('server-only', () => ({}));

const created = (customerId: string, newCustomer: boolean) => ({
  customer_id: customerId,
  new_customer: newCustomer,
});
const FOUND = { kind: 'found', customerId: 'ours' } as const;
const NONE = { kind: 'none' } as const;

describe('judgeCreatedCustomer', () => {
  it.each([
    [
      'a fresh claim creates a new customer',
      null,
      created('new', true),
      'adopt',
    ],
    [
      'a fresh claim gets an existing customer',
      null,
      created('x', false),
      'foreign',
    ],
    [
      'a reclaim whose lookup listed none creates one',
      NONE,
      created('new', true),
      'adopt',
    ],
    [
      'a reclaim whose lookup listed none gets an existing one',
      NONE,
      created('x', false),
      'unproven',
    ],
    [
      'the lookup found ours and it is returned',
      FOUND,
      created('ours', false),
      'adopt',
    ],
    [
      'the lookup found ours but another is returned',
      FOUND,
      created('x', false),
      'foreign',
    ],
    [
      'the lookup found ours but a new one is created',
      FOUND,
      created('dup', true),
      'duplicate',
    ],
    [
      'the lookup was uncertain',
      { kind: 'unknown' } as const,
      created('x', true),
      'foreign',
    ],
    [
      'the lookup was ambiguous',
      { kind: 'ambiguous' } as const,
      created('x', true),
      'foreign',
    ],
  ])('%s', (_label, lookup, answer, verdict) => {
    expect(judgeCreatedCustomer({ lookup, created: answer })).toBe(verdict);
  });
});

describe('keepCreatedWalletForReview', () => {
  const scope = {
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    customerId: 'e648eb14-928a-427b-9719-b105f6d4b8b4',
    userId: 'f4f01e61-691f-494a-a895-872f17f8e55e',
    integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
    businessId: 'business-fixture',
    environment: 'production' as const,
  };
  const ids = { providerCustomerId: 'c', providerWalletId: 'w' };
  const claimedScope = { ...scope, intentId: 'intent', claimToken: 'claim' };
  let storage: ReturnType<typeof onboardingFixture>['storage'];
  const keep = () =>
    keepCreatedWalletForReview({ storage, claimedScope, ...ids });

  beforeEach(() => {
    storage = onboardingFixture().storage;
  });

  it('rejects the intent with its ids in one step, never through a recheckable state', async () => {
    expect(await keep()).toBe(true);
    expect(storage.recordReview).toHaveBeenCalledExactlyOnceWith({
      ...claimedScope,
      ...ids,
    });
    expect(storage.recordRoutingPending).not.toHaveBeenCalled();
    expect(storage.recordRejected).not.toHaveBeenCalled();
    expect(storage.recordAccepted).not.toHaveBeenCalled();
  });

  it.each([
    ['refused (the claim was lost)', async () => false],
    ['failing', () => Promise.reject(new Error('storage down'))],
  ])('never discards the ids when keeping them is %s: nothing else is written', async (_label, review) => {
    // The dispatched lease then expires and the lookup-gated reclaim
    // records the review with the ids; an id-less rejection would leave a
    // real DVA untracked by the deletion guard.
    storage.recordReview.mockImplementation(review);
    expect(await keep()).toBe(false);
    expect(storage.recordRejected).not.toHaveBeenCalled();
    expect(storage.recordUncertain).not.toHaveBeenCalled();
    expect(storage.recordRoutingPending).not.toHaveBeenCalled();
  });
});

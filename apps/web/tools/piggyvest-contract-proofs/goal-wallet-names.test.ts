import { describe, expect, it } from 'vitest';
import { PIGGYVEST_SUBACCOUNT_NAME_MAX_CHARACTERS } from '@/lib/piggyvest/provider-wallet-name.constants';
import {
  goalWalletBaseName,
  goalWalletName,
  p7GoalSuffix,
} from './goal-wallet-names';
import { dataOf, type MockCreated } from './mock-reply.test-support';
import { MockSandbox } from './mock-sandbox';
import { qaIdentityFor } from './provider-ops';
import { proof7Key } from './qa-keys';

const longestKey = 'k'.repeat(64); // the journal's qaKey limit
const QA_KEYS = [
  'qa-customer-1',
  'baciqa-proof-20261031',
  longestKey,
  proof7Key('qa-customer-1', 1),
  proof7Key(longestKey, 99),
];
const SUFFIXES = [
  '',
  p7GoalSuffix('unset', 1),
  p7GoalSuffix('explicit', 1),
  p7GoalSuffix('unset', 99),
  p7GoalSuffix('explicit', 99),
];

describe('harness goal wallet names', () => {
  it.each(
    QA_KEYS.flatMap((qaKey) => SUFFIXES.map((suffix) => [qaKey, suffix]))
  )('keeps %j%j within the 50-character provider limit', (qaKey, suffix) => {
    const name = goalWalletName(qaIdentityFor(qaKey).goalWalletName, suffix);
    expect(name.length).toBeLessThanOrEqual(
      PIGGYVEST_SUBACCOUNT_NAME_MAX_CHARACTERS
    );
  });

  it('keeps the readable name for keys that fit, so existing goal wallets are still found', () => {
    expect(goalWalletBaseName('baciqa-proof-20261031')).toBe(
      'pvbproof-goal-baciqa-proof-20261031'
    );
  });

  it('hashes the full key when the readable name would not fit, and stays distinct', () => {
    const a = goalWalletBaseName(longestKey);
    const b = goalWalletBaseName(`${'k'.repeat(63)}j`);
    expect(a).toMatch(/^pvbproof-goal-h[0-9a-f]{24}$/);
    expect(a).not.toBe(b);
  });

  it('gives the two proof-7 variants distinct names', () => {
    const base = qaIdentityFor(proof7Key('qa-customer-1', 2)).goalWalletName;
    expect(goalWalletName(base, p7GoalSuffix('unset', 2))).not.toBe(
      goalWalletName(base, p7GoalSuffix('explicit', 2))
    );
  });

  it('refuses to build a name over the limit instead of sending a certain 422', () => {
    expect(() => goalWalletName('x'.repeat(46), '-u100')).toThrow();
    expect(goalWalletName('x'.repeat(46), '-u99')).toHaveLength(50);
  });
});

describe('MockSandbox: 50-character subaccount_name limit', () => {
  function customer() {
    const sandbox = new MockSandbox();
    const created = dataOf<MockCreated>(
      sandbox.createCustomer(
        {
          bvn: '00012345678',
          email: 'synthetic+0123456789ab@example.test',
          name: 'Synthetic Customer',
          phone: '+234000123456',
          third_party_identifier: 'pvbproof:qa-1',
        },
        true
      )
    );
    return { sandbox, customerId: created.customer_id };
  }

  it('accepts 50 characters and refuses 51 with 422, as the live sandbox did', () => {
    const { sandbox, customerId } = customer();
    expect(
      sandbox.createWallet({
        subaccount_name: 'a'.repeat(50),
        customer_id: customerId,
      }).status
    ).toBe(202);
    const refused = sandbox.createWallet({
      subaccount_name: 'b'.repeat(51),
      customer_id: customerId,
    });
    expect(refused.status).toBe(422);
    expect(refused.body).toEqual({
      status: false,
      message: 'One or more validation errors occurred',
    });
  });
});

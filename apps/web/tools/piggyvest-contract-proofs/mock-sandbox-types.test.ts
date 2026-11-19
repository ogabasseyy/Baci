import { describe, expect, it } from 'vitest';
import { DEFAULT_MOCK_OPTIONS, fail, ok, ulid } from './mock-sandbox-types';

describe('DEFAULT_MOCK_OPTIONS', () => {
  it('describes the documented happy path: no lag, no injected failures, accepted payouts', () => {
    expect(DEFAULT_MOCK_OPTIONS).toMatchObject({
      tsqShape: 'docs',
      fundingSettles: true,
      counterLagReads: 0,
      balanceLagReads: 0,
      listLagReads: 0,
      settingsLagReads: 0,
      payoutFieldLagReads: 0,
      counterLagReadsGoal: null,
      pagingMode: 'advance',
      goalInterestRate: 0,
      tsqSettleEarly: false,
      tsqPendingPollsBank: null,
      serverErrorData: null,
      accruedEdgeCount: 0,
      customerPayoutWallet: 'accepted',
      subAccountAcceptsPayout: true,
      subWalletInheritsPayout: false,
      payoutReadback: 'fields',
      goalReadbackOmitsPayout: false,
    });
    expect(DEFAULT_MOCK_OPTIONS.failNetworkOnce).toEqual([]);
    expect(DEFAULT_MOCK_OPTIONS.serverErrorPaths).toEqual([]);
    expect(DEFAULT_MOCK_OPTIONS.flakyPaths).toEqual([]);
  });

  it('models the documented fees and a wallet transfer that does not touch the counter', () => {
    expect(DEFAULT_MOCK_OPTIONS.depositFeeKobo).toBe(5_000);
    expect(DEFAULT_MOCK_OPTIONS.bankFeeKobo).toBe(5_000);
    expect(DEFAULT_MOCK_OPTIONS.w2wIncrementsCounter).toBe(false);
    expect(DEFAULT_MOCK_OPTIONS.bankIncrementsCounter).toBe(true);
  });
});

describe('ok / fail envelopes', () => {
  it('ok wraps data in the provider envelope', () => {
    expect(ok({ a: 1 }, 'done', 202)).toEqual({
      status: 202,
      body: { status: true, message: 'done', data: { a: 1 } },
    });
    expect(ok(undefined).status).toBe(200);
  });

  it('fail is a status:false envelope, 400 unless told otherwise', () => {
    expect(fail('nope')).toEqual({
      status: 400,
      body: { status: false, message: 'nope' },
    });
    expect(fail('missing', 404).status).toBe(404);
  });
});

describe('ulid', () => {
  it('makes 26-character Crockford-style ids, deterministic per salt and number', () => {
    const id = ulid('w', 1);
    expect(id).toMatch(/^01M2T[0-9A-F]{21}$/);
    expect(id).toHaveLength(26);
    expect(ulid('w', 1)).toBe(id);
    expect(ulid('w', 2)).not.toBe(id);
    expect(ulid('t', 1)).not.toBe(id);
  });
});

import { describe, expect, it } from 'vitest';
import * as zod from 'zod';
import { piggyvestDailyReconciliationSchemas as schemas } from './piggyvest-daily-reconciliation';

const stuck = {
  operationId: '00000000-0000-4000-8000-0000000000a3',
  goalId: '00000000-0000-4000-8000-0000000000b1',
  state: 'dispatched',
  amountKobo: 70000,
  sourceWalletId: 'synthetic-main-wallet',
  destinationWalletId: 'synthetic-goal-wallet',
  reference: 'synthetic-reference-1',
  ageSeconds: 3600,
};
const snapshot = {
  generatedAt: '2026-11-03T01:29:30.079678+01:00',
  staleAfterSeconds: 1800,
  businessId: 'synthetic-business',
  stuck: [stuck],
  stuckTotal: 1,
  stuckDeferred: 0,
  wallets: [{ walletId: 'synthetic-goal-wallet', expectedKobo: 150000 }],
  walletsTotal: 1,
  walletsDeferred: 0,
};

describe('piggyvest daily reconciliation schemas', () => {
  it('accepts the database snapshot, bare or as the single executor row', () => {
    expect(schemas.snapshot.parse(snapshot)).toEqual(snapshot);
    expect(schemas.snapshotRows.parse([{ result: snapshot }])).toHaveLength(1);
  });

  it.each([
    ['an extra top-level key', { ...snapshot, extra: 1 }],
    ['a missing total', { ...snapshot, stuckTotal: undefined }],
    [
      'a missing stuck deferred count',
      { ...snapshot, stuckDeferred: undefined },
    ],
    [
      'a missing wallet deferred count',
      { ...snapshot, walletsDeferred: undefined },
    ],
    ['a null deferred count', { ...snapshot, walletsDeferred: null }],
    ['a negative deferred count', { ...snapshot, stuckDeferred: -1 }],
    [
      'a wallet deferred count that does not match total minus listed',
      { ...snapshot, walletsTotal: 3, walletsDeferred: 1 },
    ],
    [
      'a stuck deferred count that hides listed rows',
      { ...snapshot, stuckTotal: 1, stuckDeferred: 1 },
    ],
    ['a non-ISO time', { ...snapshot, generatedAt: 'yesterday' }],
    ['a cutoff below one minute', { ...snapshot, staleAfterSeconds: 59 }],
    ['a null business id', { ...snapshot, businessId: null }],
    [
      'an unknown state',
      { ...snapshot, stuck: [{ ...stuck, state: 'confirmed' }] },
    ],
    ['a zero amount', { ...snapshot, stuck: [{ ...stuck, amountKobo: 0 }] }],
    ['an extra stuck key', { ...snapshot, stuck: [{ ...stuck, extra: 1 }] }],
    [
      'a negative expected balance',
      { ...snapshot, wallets: [{ walletId: 'w', expectedKobo: -1 }] },
    ],
    [
      'a fractional expected balance',
      { ...snapshot, wallets: [{ walletId: 'w', expectedKobo: 1.5 }] },
    ],
  ])('rejects %s', (_label, value) => {
    expect(schemas.snapshot.safeParse(value).success).toBe(false);
  });

  it('accepts a rotated window whose deferred count is the rest of the total', () => {
    const rotated = { ...snapshot, walletsTotal: 3, walletsDeferred: 2 };
    expect(schemas.snapshot.safeParse(rotated).success).toBe(true);
  });

  it('rejects zero or several executor rows', () => {
    expect(schemas.snapshotRows.safeParse([]).success).toBe(false);
    expect(
      schemas.snapshotRows.safeParse([
        { result: snapshot },
        { result: snapshot },
      ]).success
    ).toBe(false);
    expect(schemas.snapshotRows.safeParse([{ result: null }]).success).toBe(
      false
    );
  });

  it('validates the owner address', () => {
    expect(schemas.reportEmail.safeParse('owner@example.test').success).toBe(
      true
    );
    expect(schemas.reportEmail.safeParse('not-an-email').success).toBe(false);
  });

  it('relies only on top-level Zod 4 helpers that exist in the pinned version', () => {
    for (const helper of ['uuid', 'int', 'email', 'iso'] as const) {
      expect(zod.z[helper]).toBeDefined();
    }
    expect(typeof zod.z.iso.datetime).toBe('function');
    expect(schemas.stuckTransfer.safeParse(stuck).success).toBe(true);
    expect(
      schemas.stuckTransfer.safeParse({ ...stuck, operationId: 'not-a-uuid' })
        .success
    ).toBe(false);
    expect(
      schemas.stuckTransfer.safeParse({ ...stuck, ageSeconds: 1.5 }).success
    ).toBe(false);
    expect(schemas.reportEmail.safeParse('not-an-email').success).toBe(false);
  });
});

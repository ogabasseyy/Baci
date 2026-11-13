import { describe, expect, it } from 'vitest';
import { piggyvestGoalWalletSetupHealthSchemas as schemas } from './piggyvest-goal-wallet-setup-health';

const valid = {
  generatedAt: '2026-11-13T09:00:00.123456+00:00',
  staleAfterSeconds: 600,
  stalledGoalWallets: 3,
};

describe('piggyvestGoalWalletSetupHealthSchemas.result', () => {
  it('accepts a counts-only result', () => {
    expect(schemas.result.safeParse(valid).success).toBe(true);
    expect(
      schemas.result.safeParse({ ...valid, stalledGoalWallets: 0 }).success
    ).toBe(true);
  });

  it('requires an ISO timestamp with an offset', () => {
    expect(
      schemas.result.safeParse({ ...valid, generatedAt: 'yesterday' }).success
    ).toBe(false);
    expect(
      schemas.result.safeParse({
        ...valid,
        generatedAt: '2026-11-13T09:00:00',
      }).success
    ).toBe(false);
  });

  it.each([
    59, 86401, 600.5,
  ])('refuses staleAfterSeconds %s (whole seconds from 60 to 86400 only)', (staleAfterSeconds) => {
    expect(
      schemas.result.safeParse({ ...valid, staleAfterSeconds }).success
    ).toBe(false);
  });

  it('accepts the staleAfterSeconds boundaries', () => {
    for (const staleAfterSeconds of [60, 86400])
      expect(
        schemas.result.safeParse({ ...valid, staleAfterSeconds }).success
      ).toBe(true);
  });

  it.each([
    -1, 1.5,
  ])('refuses a stalledGoalWallets of %s', (stalledGoalWallets) => {
    expect(
      schemas.result.safeParse({ ...valid, stalledGoalWallets }).success
    ).toBe(false);
  });

  it('refuses any extra key (strict), so a changed result reads as failed', () => {
    expect(
      schemas.result.safeParse({ ...valid, goalIds: ['g1'] }).success
    ).toBe(false);
  });

  it('refuses a missing key', () => {
    const { stalledGoalWallets: _omit, ...partial } = valid;
    expect(schemas.result.safeParse(partial).success).toBe(false);
  });
});

describe('piggyvestGoalWalletSetupHealthSchemas.rows', () => {
  it('accepts exactly one row wrapping the result', () => {
    expect(schemas.rows.safeParse([{ result: valid }]).success).toBe(true);
  });

  it('refuses zero or several rows', () => {
    expect(schemas.rows.safeParse([]).success).toBe(false);
    expect(
      schemas.rows.safeParse([{ result: valid }, { result: valid }]).success
    ).toBe(false);
  });

  it('refuses an extra column on the row', () => {
    expect(schemas.rows.safeParse([{ result: valid, extra: 1 }]).success).toBe(
      false
    );
  });
});

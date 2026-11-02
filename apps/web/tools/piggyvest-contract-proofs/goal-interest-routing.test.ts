import { describe, expect, it } from 'vitest';
import {
  finalReading,
  GOAL_RECHECK_DELAY_MS,
  GOAL_ROUTING_VARIANTS,
  goalRoutingVerdict,
  inheritsBusinessPayoutAnswer,
  type PayoutPseudonym,
  readGoalRouting,
  staysInGoalAnswer,
} from './goal-interest-routing';

const IDS = {
  self: '01GOALSELF0000000000000000',
  main: '01MAINWALLET00000000000000',
  business: '01BUSINESS0000000000000000',
};

describe('goalRoutingVerdict: only the goal itself proves interest stays in it', () => {
  it('maps a payout naming the goal itself to proven', () => {
    expect(goalRoutingVerdict('self')).toBe('proven');
  });

  it.each<PayoutPseudonym>([
    'null',
    'main',
    'business',
    'other',
    'absent',
    'unread',
  ])('maps %s to not proven', (payout) => {
    expect(goalRoutingVerdict(payout)).toBe('not_proven');
  });

  it('answers yes only for self, no for a named other wallet, unknown otherwise', () => {
    expect(staysInGoalAnswer('self')).toBe('yes');
    for (const payout of ['main', 'business', 'other'] as const)
      expect(staysInGoalAnswer(payout)).toBe('no');
    for (const payout of ['null', 'absent', 'unread'] as const)
      expect(staysInGoalAnswer(payout)).toBe('unknown');
  });
});

describe('readGoalRouting: pseudonyms, never values', () => {
  const read = (record: Record<string, unknown> | null) =>
    readGoalRouting(record, IDS);

  it('names the payout relative to the wallets the proof knows', () => {
    expect(read({ interest_payout_wallet: IDS.self }).payout).toBe('self');
    expect(read({ interest_payout_wallet: IDS.main }).payout).toBe('main');
    expect(read({ interest_payout_wallet: IDS.business }).payout).toBe(
      'business'
    );
    expect(
      read({ interest_payout_wallet: '01SOMEONEELSE0000000000000' }).payout
    ).toBe('other');
  });

  it('separates an explicit null from an omitted field and from no readback', () => {
    expect(read({ interest_payout_wallet: null }).payout).toBe('null');
    expect(read({ interest_payout_wallet: '' }).payout).toBe('null');
    expect(read({ interest_enabled: true }).payout).toBe('absent');
    expect(read(null)).toEqual({ interestEnabled: null, payout: 'unread' });
  });

  it('reads the live interest_enabled flag, and the mock request-named flag', () => {
    expect(read({ interest_enabled: false }).interestEnabled).toBe(false);
    expect(read({ enable_interest_accrual: true }).interestEnabled).toBe(true);
    expect(read({ interest_enabled: 'yes' }).interestEnabled).toBeNull();
  });

  it('never names main when the proof has no main wallet id', () => {
    expect(
      readGoalRouting(
        { interest_payout_wallet: IDS.main },
        { ...IDS, main: null }
      ).payout
    ).toBe('other');
  });
});

describe('finalReading', () => {
  const at = (payout: PayoutPseudonym) => ({ interestEnabled: true, payout });

  it('prefers the five-minute reading when it was read', () => {
    expect(finalReading(at('null'), at('self')).payout).toBe('self');
    expect(finalReading(at('self'), at('null')).payout).toBe('null');
  });

  it('falls back to the first reading when the recheck could not be read', () => {
    expect(finalReading(at('main'), at('unread')).payout).toBe('main');
  });
});

describe('GOAL_ROUTING_VARIANTS', () => {
  it('covers opted-in unset, opted-out unset, payout main and payout business, each in its own slot', () => {
    expect(
      GOAL_ROUTING_VARIANTS.map((v) => [v.id, v.accrual, v.payout])
    ).toEqual([
      ['a', true, 'unset'],
      ['b', false, 'unset'],
      ['c', true, 'main'],
      ['d', true, 'business'],
    ]);
    const slots = GOAL_ROUTING_VARIANTS.map((v) => v.slot);
    expect(new Set(slots).size).toBe(4);
    // Never the slots earlier runs used for the long-name variants.
    expect(slots).not.toContain('p7/goal_unset');
    expect(slots).not.toContain('p7/goal_explicit');
  });

  it('rechecks after five minutes', () => {
    expect(GOAL_RECHECK_DELAY_MS).toBe(300_000);
  });
});

describe('inheritsBusinessPayoutAnswer: goal (a) from its final reading', () => {
  const SHOWN = ['interest_payout_wallet'];

  it('yes when the goal names the business wallet, whatever the main wallet showed', () => {
    expect(inheritsBusinessPayoutAnswer('business', SHOWN)).toBe('yes');
    expect(inheritsBusinessPayoutAnswer('business', [])).toBe('yes');
  });

  it.each<PayoutPseudonym>([
    'self',
    'main',
    'other',
  ])('no when it names %s and the main wallet showed the same field; unknown otherwise', (payout) => {
    expect(inheritsBusinessPayoutAnswer(payout, SHOWN)).toBe('no');
    expect(inheritsBusinessPayoutAnswer(payout, [])).toBe('unknown');
  });

  it('a null payout proves nothing: unobservable, never no', () => {
    expect(inheritsBusinessPayoutAnswer('null', SHOWN)).toBe('unobservable');
    expect(inheritsBusinessPayoutAnswer('null', [])).toBe('unknown');
  });

  it.each<PayoutPseudonym>([
    'absent',
    'unread',
  ])('unknown when the payout is %s', (payout) => {
    expect(inheritsBusinessPayoutAnswer(payout, SHOWN)).toBe('unknown');
  });
});

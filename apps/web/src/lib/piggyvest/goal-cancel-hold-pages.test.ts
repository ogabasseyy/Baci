import { expect, it } from 'vitest';
import { HOLD_PAGES } from './goal-cancel-hold-pages';

it('pages every hold with its own reason, and nothing for other answers', () => {
  expect(HOLD_PAGES.needs_review?.reason).toBe(
    'provider_balance_below_principal'
  );
  expect(HOLD_PAGES.forfeit_unavailable).toEqual({
    code: 'PIGGYVEST_GOAL_CANCEL_FORFEIT_UNAVAILABLE',
    reason: 'interest_wallet_missing',
  });
  expect(HOLD_PAGES.too_large?.reason).toBe('principal_above_transfer_limit');
  expect(HOLD_PAGES.dispatched).toBeUndefined();
});

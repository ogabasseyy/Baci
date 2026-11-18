import { beforeEach, describe, expect, it } from 'vitest';
import {
  FALLBACK_MAX_PER_WINDOW,
  resetAuthFallbackBudgetForTesting,
  takeAuthFallbackSlot,
} from './quiz-auth-fallback-budget';

describe('quiz auth fallback budget', () => {
  beforeEach(() => resetAuthFallbackBudgetForTesting());

  it('allows the budget, then refuses for the rest of the window', () => {
    for (let call = 0; call < FALLBACK_MAX_PER_WINDOW; call += 1) {
      expect(takeAuthFallbackSlot(1_000)).toBe(true);
    }

    expect(takeAuthFallbackSlot(1_000)).toBe(false);
    expect(takeAuthFallbackSlot(10_999)).toBe(false);
  });

  it('starts a new budget when the window has passed', () => {
    for (let call = 0; call < FALLBACK_MAX_PER_WINDOW; call += 1) {
      takeAuthFallbackSlot(1_000);
    }

    expect(takeAuthFallbackSlot(11_000)).toBe(true);
  });
});

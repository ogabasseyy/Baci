import { expect, it } from 'vitest';
import {
  OXYGEN_CALLBACK_DURATION_MS,
  OXYGEN_CALLBACK_MIN_REMAINING_MS,
} from './reconciliation-budget';

it('reserves enough time for three cold provider calls and persistence', () => {
  const providerAndLoginBudgetMs = 3 * 2 * 30_000;
  expect(OXYGEN_CALLBACK_MIN_REMAINING_MS).toBeGreaterThanOrEqual(
    providerAndLoginBudgetMs + 60_000
  );
  expect(OXYGEN_CALLBACK_DURATION_MS).toBeGreaterThanOrEqual(
    OXYGEN_CALLBACK_MIN_REMAINING_MS
  );
});

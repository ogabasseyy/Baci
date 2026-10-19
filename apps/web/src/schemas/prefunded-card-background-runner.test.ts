import { describe, expect, it } from 'vitest';
import {
  PREFUNDED_CARD_BACKGROUND_MAX_DISPATCH_BATCH_SIZE,
  prefundedCardBackgroundRunnerSchemas,
} from './prefunded-card-background-runner';

describe('prefunded card background dispatch result schema', () => {
  it('accepts bounded worker totals whose claimed operations all finish', () => {
    expect(
      prefundedCardBackgroundRunnerSchemas.dispatchResult.safeParse({
        claimed: PREFUNDED_CARD_BACKGROUND_MAX_DISPATCH_BATCH_SIZE,
        processed: 17,
        failed: 3,
        unacknowledged: 1,
      }).success
    ).toBe(true);
  });

  it.each([
    { claimed: 1, processed: 1, failed: 1, unacknowledged: 0 },
    { claimed: 1, processed: 0, failed: 0, unacknowledged: 0 },
    { claimed: 1, processed: 1, failed: 0, unacknowledged: 2 },
    {
      claimed: PREFUNDED_CARD_BACKGROUND_MAX_DISPATCH_BATCH_SIZE + 1,
      processed: 21,
      failed: 0,
      unacknowledged: 0,
    },
    {
      claimed: 1,
      processed: 1.5,
      failed: 0,
      unacknowledged: 0,
    },
  ])('rejects impossible or out-of-bound worker totals %#', (input) => {
    expect(
      prefundedCardBackgroundRunnerSchemas.dispatchResult.safeParse(input)
        .success
    ).toBe(false);
  });

  it('rejects extra worker fields', () => {
    expect(
      prefundedCardBackgroundRunnerSchemas.dispatchResult.safeParse({
        claimed: 0,
        processed: 0,
        failed: 0,
        unacknowledged: 0,
        providerResponse: 'private',
      }).success
    ).toBe(false);
  });
});

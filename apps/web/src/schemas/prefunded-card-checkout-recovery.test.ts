import { describe, expect, it } from 'vitest';
import { prefundedCardCheckoutFixture } from '@/lib/piggyvest/prefunded-card-checkout.test-fixture';
import { prefundedCardCheckoutRecoverySchemas } from './prefunded-card-checkout-recovery';

const fixture = prefundedCardCheckoutFixture();

describe('prefunded first-card recovery schemas', () => {
  it('accepts a bounded page only when its next cursor is the final durable candidate', () => {
    const first = {
      createdAt: '2026-09-26T12:00:00.000Z',
      intentId: fixture.intent.intentId,
    };
    const second = {
      createdAt: '2026-09-26T12:01:00.000Z',
      intentId: '00000000-0000-4000-8000-000000000010',
    };

    expect(
      prefundedCardCheckoutRecoverySchemas.page.parse({
        candidates: [{ cursor: first, intent: fixture.intent }],
        nextCursor: first,
      })
    ).toEqual({
      candidates: [{ cursor: first, intent: fixture.intent }],
      nextCursor: first,
    });
    expect(
      prefundedCardCheckoutRecoverySchemas.request.safeParse({
        after: first,
        limit: 21,
      }).success
    ).toBe(false);
    expect(
      prefundedCardCheckoutRecoverySchemas.page.safeParse({
        candidates: [{ cursor: first, intent: fixture.intent }],
        nextCursor: second,
      }).success
    ).toBe(false);
  });
});

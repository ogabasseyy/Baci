import { describe, expect, it } from 'vitest';
import { redemptionIdempotencyKeys } from './loyalty-redemption-keys';

describe('redemptionIdempotencyKeys', () => {
  it('returns a stable key per reward until cleared', () => {
    const first = redemptionIdempotencyKeys.forReward('reward-a');
    const second = redemptionIdempotencyKeys.forReward('reward-a');
    const other = redemptionIdempotencyKeys.forReward('reward-b');

    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(second).toBe(first);
    expect(other).not.toBe(first);

    redemptionIdempotencyKeys.clearForReward('reward-a');
    expect(redemptionIdempotencyKeys.forReward('reward-a')).not.toBe(first);

    redemptionIdempotencyKeys.clearForReward('reward-b');
  });
});

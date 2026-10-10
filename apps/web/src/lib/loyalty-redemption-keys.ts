// Stable-per-reward idempotency keys for loyalty redemption.
//
// A timeout retry must reuse the key from the failed attempt (a fresh
// key per call would mint a second redemption), so keys persist per
// reward until that reward redeems successfully. Module-level on
// purpose: two hook instances redeeming the same reward share one
// intent, so they share one key.
const keysByReward = new Map<string, string>();

function keyForReward(rewardId: string): string {
  const existing = keysByReward.get(rewardId);
  if (existing) {
    return existing;
  }
  const fresh = crypto.randomUUID();
  keysByReward.set(rewardId, fresh);
  return fresh;
}

function clearKeyForReward(rewardId: string): void {
  keysByReward.delete(rewardId);
}

export const redemptionIdempotencyKeys = {
  forReward: keyForReward,
  clearForReward: clearKeyForReward,
};

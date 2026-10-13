/**
 * Single-owner coordination for fullscreen quiz ads. The rewarded-badge flow
 * claims ownership synchronously on tap (before any rerender) and the
 * quiz-start interstitial yields while it is claimed, so the two placements
 * can never race to present over each other.
 */
let rewardedFlowActive = false;

export function setQuizRewardedFlowActive(active: boolean): void {
  rewardedFlowActive = active;
}

export function isQuizRewardedFlowActive(): boolean {
  return rewardedFlowActive;
}

export function resetQuizFullscreenOwnershipForTests(): void {
  rewardedFlowActive = false;
}

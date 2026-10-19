import { describe, expect, it } from '@jest/globals';
import {
  isQuizRewardedFlowActive,
  resetQuizFullscreenOwnershipForTests,
  setQuizRewardedFlowActive,
} from './quiz-fullscreen-ownership';

describe('quiz-fullscreen-ownership', () => {
  it('tracks and resets rewarded fullscreen ownership', () => {
    resetQuizFullscreenOwnershipForTests();
    expect(isQuizRewardedFlowActive()).toBe(false);

    setQuizRewardedFlowActive(true);
    expect(isQuizRewardedFlowActive()).toBe(true);

    resetQuizFullscreenOwnershipForTests();
    expect(isQuizRewardedFlowActive()).toBe(false);
  });
});

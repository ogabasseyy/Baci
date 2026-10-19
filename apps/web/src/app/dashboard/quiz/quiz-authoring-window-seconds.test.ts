import { getSuggestedQuizLiveWindowSeconds } from '@baci/shared';
import { describe, expect, it } from 'vitest';
import { resolveQuizAuthoringWindowSeconds } from './quiz-authoring-window-seconds';

describe('resolveQuizAuthoringWindowSeconds', () => {
  it('floors test mode to 60 seconds when no questions exist yet', () => {
    // Arrange & Act
    const seconds = resolveQuizAuthoringWindowSeconds({
      mode: 'test',
      questionCount: 0,
      timePerQuestionSeconds: 10,
    });

    // Assert
    expect(seconds).toBe(60);
  });

  it('uses raw expected play in test mode once it exceeds the floor', () => {
    // Arrange & Act
    const seconds = resolveQuizAuthoringWindowSeconds({
      mode: 'test',
      questionCount: 2,
      timePerQuestionSeconds: 35,
    });

    // Assert
    expect(seconds).toBe(70);
  });

  it('tracks the shared suggested live window in live mode', () => {
    // Arrange & Act
    const seconds = resolveQuizAuthoringWindowSeconds({
      mode: 'live',
      questionCount: 2,
      timePerQuestionSeconds: 10,
    });

    // Assert: 20s of play plus the documented grace, whole minutes.
    expect(seconds).toBe(120);
    expect(seconds).toBe(getSuggestedQuizLiveWindowSeconds(2, 10));
  });

  it('floors live mode when no questions exist yet', () => {
    // Arrange & Act
    const seconds = resolveQuizAuthoringWindowSeconds({
      mode: 'live',
      questionCount: 0,
      timePerQuestionSeconds: 10,
    });

    // Assert
    expect(seconds).toBe(60);
  });
});

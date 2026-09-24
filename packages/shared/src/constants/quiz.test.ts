import { describe, expect, it } from 'vitest';
import {
  EXAM_PASS_POINTS_COST,
  getQuizLaunchPolicy,
  getQuizMaxAttemptsForMode,
  getQuizMaximumPlaySeconds,
  getQuizWindowBounds,
  getSuggestedQuizLiveWindowSeconds,
  isQuizAttemptExcludedFromTestCap,
  isQuizAttemptNonRankingTerminal,
  isQuizWindowSecondsAllowed,
  QUIZ_ACTIVE_ATTEMPT_RECONCILIATION_CADENCE_SECONDS,
  QUIZ_CONTRACT_HEADER,
  QUIZ_CONTRACT_VERSION,
  QUIZ_DEFAULT_TIME_ZONE,
  QUIZ_DEVICE_BIND_RPC_ACTION,
  QUIZ_DEVICE_START_RPC_ACTION,
  QUIZ_FREE_ENTRY_MODE,
  QUIZ_FREE_ENTRY_RPC_ACTION,
  QUIZ_GENERATION_MAX_ACTIVE_JOBS_PER_MERCHANT,
  QUIZ_GENERATION_MAX_NEW_JOBS_PER_MERCHANT_ROLLING_24_HOURS,
  QUIZ_LIVE_MAX_ATTEMPTS,
  QUIZ_LIVE_RULES_VERSION,
  QUIZ_LIVE_VARIANTS_PER_QUESTION,
  QUIZ_MAX_LOGICAL_QUESTIONS,
  QUIZ_MAX_QUESTIONS_PER_TOPIC,
  QUIZ_MAX_TIME_PER_QUESTION_SECONDS,
  QUIZ_MIN_QUESTIONS_PER_TOPIC,
  QUIZ_MIN_TIME_PER_QUESTION_SECONDS,
  QUIZ_NON_RANKING_TERMINAL_ATTEMPT_STATUSES,
  QUIZ_TEST_ATTEMPT_CAP_EXCLUDED_STATUSES,
  QUIZ_TEST_DEFAULT_MAX_ATTEMPTS,
  QUIZ_TEST_DEFAULT_VARIANTS_PER_QUESTION,
  QUIZ_TEST_MAX_MAX_ATTEMPTS,
  QUIZ_TEST_MAX_VARIANTS_PER_QUESTION,
  QUIZ_TEST_MIN_MAX_ATTEMPTS,
  QUIZ_TEST_MIN_VARIANTS_PER_QUESTION,
  QUIZ_TEST_RULES_VERSION,
  QUIZ_TEST_WINDOW_MAXIMUM_SECONDS,
} from './quiz';

describe('quiz constants', () => {
  it('charges nothing to enter a quiz, so entry is not purchase-gated', () => {
    expect(typeof EXAM_PASS_POINTS_COST).toBe('number');
    expect(Number.isInteger(EXAM_PASS_POINTS_COST)).toBe(true);
    expect(EXAM_PASS_POINTS_COST).toBe(0);
  });

  it('pins the free-entry client protocol marker', () => {
    expect(QUIZ_FREE_ENTRY_MODE).toBe('free-v1');
    expect(QUIZ_FREE_ENTRY_RPC_ACTION).toBe('start_quiz_attempt_free_v1');
    expect(QUIZ_DEVICE_BIND_RPC_ACTION).toBe('bind_quiz_attempt_device_v1');
    expect(QUIZ_DEVICE_START_RPC_ACTION).toBe(
      'start_quiz_attempt_with_device_v1'
    );
  });

  it('centralizes the v2 authoring and retry limits', () => {
    expect(QUIZ_CONTRACT_VERSION).toBe(2);
    expect(QUIZ_CONTRACT_HEADER).toBe('X-Baci-Quiz-Contract');
    expect(QUIZ_MIN_QUESTIONS_PER_TOPIC).toBe(1);
    expect(QUIZ_MAX_QUESTIONS_PER_TOPIC).toBe(20);
    expect(QUIZ_MAX_LOGICAL_QUESTIONS).toBe(50);
    expect(QUIZ_MIN_TIME_PER_QUESTION_SECONDS).toBe(5);
    expect(QUIZ_MAX_TIME_PER_QUESTION_SECONDS).toBe(60);
    expect(QUIZ_DEFAULT_TIME_ZONE).toBe('Africa/Lagos');
    expect(QUIZ_TEST_RULES_VERSION).toBe('test-v1');
    expect(QUIZ_LIVE_RULES_VERSION).toBe('live-v1');
    expect(QUIZ_TEST_DEFAULT_VARIANTS_PER_QUESTION).toBe(1);
    expect(QUIZ_TEST_MIN_VARIANTS_PER_QUESTION).toBe(1);
    expect(QUIZ_TEST_MAX_VARIANTS_PER_QUESTION).toBe(3);
    expect(QUIZ_LIVE_VARIANTS_PER_QUESTION).toBe(3);
    expect(QUIZ_TEST_DEFAULT_MAX_ATTEMPTS).toBe(10);
    expect(QUIZ_TEST_MIN_MAX_ATTEMPTS).toBe(1);
    expect(QUIZ_TEST_MAX_MAX_ATTEMPTS).toBe(50);
    expect(QUIZ_LIVE_MAX_ATTEMPTS).toBe(1);
    expect(QUIZ_ACTIVE_ATTEMPT_RECONCILIATION_CADENCE_SECONDS).toBe(15);
    expect(QUIZ_GENERATION_MAX_NEW_JOBS_PER_MERCHANT_ROLLING_24_HOURS).toBe(10);
    expect(QUIZ_GENERATION_MAX_ACTIVE_JOBS_PER_MERCHANT).toBe(1);
  });

  it('centralizes mode-specific launch rules so live cannot inherit test rules', () => {
    expect(getQuizLaunchPolicy('test')).toEqual({
      maxAttempts: QUIZ_TEST_DEFAULT_MAX_ATTEMPTS,
      rulesVersion: QUIZ_TEST_RULES_VERSION,
      timeZone: QUIZ_DEFAULT_TIME_ZONE,
      variantsPerQuestion: QUIZ_TEST_DEFAULT_VARIANTS_PER_QUESTION,
    });
    expect(getQuizLaunchPolicy('live')).toEqual({
      maxAttempts: QUIZ_LIVE_MAX_ATTEMPTS,
      rulesVersion: QUIZ_LIVE_RULES_VERSION,
      timeZone: QUIZ_DEFAULT_TIME_ZONE,
      variantsPerQuestion: QUIZ_LIVE_VARIANTS_PER_QUESTION,
    });
  });

  it('calculates documented live-window timing without duplicating the formula', () => {
    expect(getQuizMaximumPlaySeconds(20, 10)).toBe(200);
    expect(getSuggestedQuizLiveWindowSeconds(20, 10)).toBe(300);
    expect(getQuizWindowBounds('live', 20, 10)).toEqual({
      maximumSeconds: 320,
      minimumSeconds: 230,
    });
    expect(isQuizWindowSecondsAllowed('live', 20, 10, 230)).toBe(true);
    expect(isQuizWindowSecondsAllowed('live', 20, 10, 320)).toBe(true);
    expect(isQuizWindowSecondsAllowed('live', 20, 10, 229)).toBe(false);
    expect(isQuizWindowSecondsAllowed('live', 20, 10, 321)).toBe(false);
    expect(isQuizWindowSecondsAllowed('live', 0, 10, 300)).toBe(false);
    expect(isQuizWindowSecondsAllowed('live', 20, 0, 300)).toBe(false);
    expect(isQuizWindowSecondsAllowed('live', 20, 10, 300.5)).toBe(false);
    const unevenSuggestion = getSuggestedQuizLiveWindowSeconds(7, 5);
    expect(unevenSuggestion).toBe(120);
    expect(isQuizWindowSecondsAllowed('live', 7, 5, unevenSuggestion)).toBe(
      true
    );
  });

  it('rejects invalid timing inputs before calculating a play window', () => {
    expect(() => getQuizMaximumPlaySeconds(0, 10)).toThrow(RangeError);
    expect(() => getQuizMaximumPlaySeconds(1.5, 10)).toThrow(RangeError);
    expect(() => getQuizMaximumPlaySeconds(20, 0)).toThrow(RangeError);
    expect(() => getQuizMaximumPlaySeconds(20, 10.5)).toThrow(RangeError);
  });

  it('allows shorter QA windows only when they cover the first test question', () => {
    expect(getQuizWindowBounds('test', 20, 10)).toEqual({
      maximumSeconds: QUIZ_TEST_WINDOW_MAXIMUM_SECONDS,
      minimumSeconds: 10,
    });
    expect(isQuizWindowSecondsAllowed('test', 20, 10, 10)).toBe(true);
    expect(isQuizWindowSecondsAllowed('test', 20, 10, 9)).toBe(false);
    expect(
      isQuizWindowSecondsAllowed(
        'test',
        20,
        10,
        QUIZ_TEST_WINDOW_MAXIMUM_SECONDS + 1
      )
    ).toBe(false);
  });

  it('documents reset and revocation lifecycle semantics for later database use', () => {
    expect(QUIZ_TEST_ATTEMPT_CAP_EXCLUDED_STATUSES).toEqual(['test_reset']);
    expect(isQuizAttemptExcludedFromTestCap('test_reset')).toBe(true);
    expect(isQuizAttemptExcludedFromTestCap('scored')).toBe(false);
    expect(QUIZ_NON_RANKING_TERMINAL_ATTEMPT_STATUSES).toEqual([
      'disqualified',
      'expired',
      'test_reset',
      'tester_revoked',
      'event_cancelled',
    ]);
    expect(isQuizAttemptNonRankingTerminal('expired')).toBe(true);
    expect(isQuizAttemptNonRankingTerminal('tester_revoked')).toBe(true);
    expect(isQuizAttemptNonRankingTerminal('event_cancelled')).toBe(true);
    expect(isQuizAttemptNonRankingTerminal('scored')).toBe(false);
  });

  it('enforces attempt caps for test mode and fixes live mode at one', () => {
    expect(getQuizMaxAttemptsForMode('test', QUIZ_TEST_MIN_MAX_ATTEMPTS)).toBe(
      QUIZ_TEST_MIN_MAX_ATTEMPTS
    );
    expect(getQuizMaxAttemptsForMode('test', QUIZ_TEST_MAX_MAX_ATTEMPTS)).toBe(
      QUIZ_TEST_MAX_MAX_ATTEMPTS
    );
    expect(getQuizMaxAttemptsForMode('live', 12)).toBe(1);
    expect(() => getQuizMaxAttemptsForMode('test', 0)).toThrow(RangeError);
    expect(() =>
      getQuizMaxAttemptsForMode('test', QUIZ_TEST_MAX_MAX_ATTEMPTS + 1)
    ).toThrow(RangeError);
  });
});

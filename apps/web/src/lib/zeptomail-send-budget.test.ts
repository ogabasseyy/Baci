import { describe, expect, it } from 'vitest';
import {
  clampZeptomailAttemptsPerSender,
  resolveZeptomailFallbackAdmission,
  senderLoopWorstMs,
  zeptomailSendAdmissionBudgetMs,
} from './zeptomail-send-budget';

describe('zeptomail send budget', () => {
  it('sizes one attempt as transport worst case plus audit margin', () => {
    expect(senderLoopWorstMs(1)).toBe(30_000 + 8_000);
  });

  it('adds exponential backoff for each extra attempt', () => {
    expect(senderLoopWorstMs(2)).toBe(2 * 30_000 + 1_000 + 8_000);
    expect(senderLoopWorstMs(4)).toBe(
      4 * 30_000 + (1_000 + 2_000 + 4_000) + 8_000
    );
  });

  it('clamps attempts into the configured retry loop', () => {
    expect(senderLoopWorstMs(0)).toBe(senderLoopWorstMs(1));
    expect(senderLoopWorstMs(99)).toBe(senderLoopWorstMs(4));
  });

  it('admits a send with the loop plus the abort buffer', () => {
    expect(zeptomailSendAdmissionBudgetMs(1)).toBe(48_000);
    expect(zeptomailSendAdmissionBudgetMs()).toBe(
      senderLoopWorstMs(4) + 10_000
    );
  });

  it('clamps per-sender attempt caps into the retry loop', () => {
    expect(clampZeptomailAttemptsPerSender(0)).toBe(1);
    expect(clampZeptomailAttemptsPerSender(2)).toBe(2);
    expect(clampZeptomailAttemptsPerSender(99)).toBe(4);
  });

  it('runs the full fallback loop without a deadline', () => {
    expect(resolveZeptomailFallbackAdmission({ attemptsPerSender: 4 })).toEqual(
      {
        fallbackAttempts: 4,
        fallbackBudgetMs: undefined,
        fallbackFits: true,
        fallbackWorstMs: senderLoopWorstMs(4),
      }
    );
  });

  it('single-shots the fallback when one attempt fits the budget', () => {
    const admission = resolveZeptomailFallbackAdmission({
      attemptsPerSender: 4,
      remainingBudgetMs: senderLoopWorstMs(1),
    });

    expect(admission).toEqual({
      fallbackAttempts: 1,
      fallbackBudgetMs: senderLoopWorstMs(1),
      fallbackFits: true,
      fallbackWorstMs: senderLoopWorstMs(1),
    });
  });

  it('declines the fallback when even one attempt overruns', () => {
    const admission = resolveZeptomailFallbackAdmission({
      attemptsPerSender: 4,
      remainingBudgetMs: senderLoopWorstMs(1) - 1,
    });

    expect(admission.fallbackAttempts).toBe(1);
    expect(admission.fallbackFits).toBe(false);
  });
});

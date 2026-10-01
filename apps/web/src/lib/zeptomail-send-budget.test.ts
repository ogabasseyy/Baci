import { describe, expect, it } from 'vitest';
import {
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
});

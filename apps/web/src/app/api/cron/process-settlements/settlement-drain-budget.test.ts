import { describe, expect, it } from 'vitest';
import {
  settlementDrainDeadlineMs,
  settlementDrainLimit,
} from './settlement-drain-budget';

describe('settlement drain budget', () => {
  it('sets the deadline at the invocation budget minus the abort margin', () => {
    expect(settlementDrainDeadlineMs(1_000_000)).toBe(1_270_000);
  });

  it('fits nine worst-case steps when the settlement phases were instant', () => {
    expect(settlementDrainLimit(0)).toBe(9);
  });

  it('shrinks the step count as the settlement phases consume the budget', () => {
    expect(settlementDrainLimit(120_000)).toBe(5);
  });

  it('drains nothing once the abort margin is gone', () => {
    expect(settlementDrainLimit(270_000)).toBe(0);
    expect(settlementDrainLimit(300_000)).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  creditComplete,
  expectedCreditKobo,
  movementSettled,
} from './settle-rule';

describe('settle rule', () => {
  it('expects the gross minus the recorded fee, and the full gross while the fee is unread', () => {
    expect(expectedCreditKobo(100, 5)).toBe(95);
    expect(expectedCreditKobo(100, null)).toBe(100);
  });

  it('is complete only at the expected credit; a partial tranche never is', () => {
    expect(creditComplete(95, 100, 5)).toBe(true);
    expect(creditComplete(100, 100, null)).toBe(true);
    expect(creditComplete(70, 100, 5)).toBe(false);
    // The net credit with an unread fee is indistinguishable from a tranche.
    expect(creditComplete(95, 100, null)).toBe(false);
    expect(creditComplete(null, 100, 0)).toBe(false);
  });

  it('never treats an over-credit (a double booking) as a complete single movement', () => {
    expect(creditComplete(200, 100, null)).toBe(false);
    expect(creditComplete(101, 100, 5)).toBe(false);
    expect(
      movementSettled({
        creditedKobo: 200,
        previousCreditedKobo: 200,
        grossKobo: 100,
        feeKobo: null,
      })
    ).toBe(false);
  });

  it('settles only when complete AND unchanged since the previous observation', () => {
    const base = { grossKobo: 100, feeKobo: 5 };
    expect(
      movementSettled({ ...base, creditedKobo: 95, previousCreditedKobo: 95 })
    ).toBe(true);
    expect(
      movementSettled({ ...base, creditedKobo: 95, previousCreditedKobo: null })
    ).toBe(false);
    expect(
      movementSettled({ ...base, creditedKobo: 95, previousCreditedKobo: 70 })
    ).toBe(false);
    expect(
      movementSettled({ ...base, creditedKobo: 70, previousCreditedKobo: 70 })
    ).toBe(false);
  });
});

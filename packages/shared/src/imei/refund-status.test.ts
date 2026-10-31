import { describe, expect, it } from 'vitest';
import { isConfirmedImeiRefund } from './refund-status';

describe('confirmed IMEI refunds', () => {
  it.each([
    [404, 'SICKW_NOT_FOUND'],
    [404, 'PETROCK_REJECTED'],
    [502, 'SICKW_UNAVAILABLE'],
    [502, 'PETROCK_NOT_SUBMITTED'],
    [502, 'PETROCK_REJECTED'],
    [502, 'PETROCK_UNAVAILABLE'],
  ])('accepts %s %s', (status, code) => {
    expect(isConfirmedImeiRefund(status, code)).toBe(true);
  });
  it.each([
    [502, 'REFUND_PENDING'],
    [503, 'PETROCK_REJECTED'],
    [404, 'LOOKUP_NOT_FOUND'],
    [500, 'INTERNAL_ERROR'],
  ])('preserves uncertain %s %s', (status, code) => {
    expect(isConfirmedImeiRefund(status, code)).toBe(false);
  });
});

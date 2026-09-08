import { describe, expect, it } from 'vitest';
import { canUseRepairBooking } from './repair-page-content';

describe('canUseRepairBooking', () => {
  it('rejects a missing merchant', () => {
    expect(canUseRepairBooking(null)).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canUseRepairBooking } from './repair-page-content';

describe('canUseRepairBooking', () => {
  it('rejects a missing merchant', () => {
    expect(canUseRepairBooking(null)).toBe(false);
  });
});

describe('RepairPageContent', () => {
  it('puts pre-booking guidance before the booking wizard', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'repair-page-content.tsx'),
      'utf8'
    );
    const prep = source.indexOf('<RepairBookingPrepSection');
    const wizard = source.indexOf('<RepairBookingWizard');

    expect(prep).toBeGreaterThan(-1);
    expect(prep).toBeLessThan(wizard);
  });
});

import { describe, expect, it } from 'vitest';
import {
  countPhoneDigits,
  formatPhoneForMyCover,
  formatPhoneToE164,
  hasMinimumPhoneDigits,
} from '@/lib/phone';

// ---------------------------------------------------------------------------
// These tests describe the phone utility module that will be created as part
// of the MyCover v2 migration. They will FAIL until phone.ts is implemented.
// ---------------------------------------------------------------------------

describe('formatPhoneToE164()', () => {
  it('converts local Nigerian number to E.164', () => {
    expect(formatPhoneToE164('08012345678')).toBe('+2348012345678');
  });

  it('adds + prefix to international number without it', () => {
    expect(formatPhoneToE164('2348012345678')).toBe('+2348012345678');
  });

  it('returns already-valid E.164 number unchanged', () => {
    expect(formatPhoneToE164('+2348012345678')).toBe('+2348012345678');
  });

  it('returns empty string for single-digit input', () => {
    expect(formatPhoneToE164('0')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(formatPhoneToE164('')).toBe('');
  });

  it('defaults to Nigeria (+234) country code', () => {
    // No second argument -> defaults to NG
    expect(formatPhoneToE164('08012345678')).toBe('+2348012345678');
  });
});

describe('formatPhoneForMyCover()', () => {
  it('converts local Nigerian number to MyCover format (no + prefix)', () => {
    expect(formatPhoneForMyCover('08012345678')).toBe('2348012345678');
  });

  it('strips + prefix from E.164 number', () => {
    expect(formatPhoneForMyCover('+2348012345678')).toBe('2348012345678');
  });

  it('returns already-correct international number unchanged', () => {
    expect(formatPhoneForMyCover('2348012345678')).toBe('2348012345678');
  });
});

describe('countPhoneDigits / hasMinimumPhoneDigits', () => {
  it('counts digits after stripping separators', () => {
    expect(countPhoneDigits('0803------')).toBe(4);
    expect(countPhoneDigits('+234 801 234 5678')).toBe(13);
  });

  it('bugfix: refuses separator-padded phones that pass length schema', () => {
    expect(hasMinimumPhoneDigits('0803------')).toBe(false);
    expect(hasMinimumPhoneDigits('08031234567')).toBe(true);
  });
});

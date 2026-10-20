import { describe, it, expect } from 'vitest';
import { isValidNigerianPhone } from './phone';

describe('isValidNigerianPhone', () => {
  it('validates standard local format', () => {
    expect(isValidNigerianPhone('08012345678')).toBe(true);
    expect(isValidNigerianPhone('09087654321')).toBe(true);
    expect(isValidNigerianPhone('07033333333')).toBe(true);
  });

  it('validates international format with +', () => {
    expect(isValidNigerianPhone('+2348012345678')).toBe(true);
    expect(isValidNigerianPhone('+2349087654321')).toBe(true);
  });

  it('validates international format without +', () => {
    expect(isValidNigerianPhone('2348012345678')).toBe(true);
    expect(isValidNigerianPhone('2349087654321')).toBe(true);
  });

  it('handles spaces, dashes, and dots', () => {
    expect(isValidNigerianPhone('080 1234 5678')).toBe(true);
    expect(isValidNigerianPhone('080-1234-5678')).toBe(true);
    expect(isValidNigerianPhone('+234.801.234.5678')).toBe(true);
  });

  it('rejects invalid numbers', () => {
    expect(isValidNigerianPhone('12345')).toBe(false); // Too short
    expect(isValidNigerianPhone('0801234567')).toBe(false); // Too short (10 digits)
    expect(isValidNigerianPhone('080123456789')).toBe(false); // Too long
    expect(isValidNigerianPhone('06012345678')).toBe(false); // Invalid prefix (060)
    expect(isValidNigerianPhone('+12348012345678')).toBe(false); // Wrong country code
    expect(isValidNigerianPhone('abc12345678')).toBe(false); // Non-numeric
    expect(isValidNigerianPhone('')).toBe(false); // Empty
  });
});

import { describe, expect, it } from 'vitest';
import {
  type FormatMoneyCompactOptions,
  formatMoneyCompact,
} from './format-money-compact';

const NBSP = '\u00A0';
const NNBSP = '\u202F';

describe('formatMoneyCompact', () => {
  it('pins compact outputs and keeps small amounts standard', () => {
    expect(formatMoneyCompact(1_200_000, 'NGN')).toBe('₦1.2M');
    expect(formatMoneyCompact(3_400_000_000, 'NGN')).toBe('₦3.4B');
    expect(formatMoneyCompact(500, 'NGN')).toBe('₦500.00');
    expect(formatMoneyCompact(500.5, 'XAF')).toBe(`501${NBSP}FCFA`);
  });

  it('resolves single-bound overrides without throwing', () => {
    expect(
      formatMoneyCompact(1_200_000, 'NGN', { maximumFractionDigits: 0 })
    ).toBe('₦1M');
    expect(formatMoneyCompact(500, 'NGN', { minimumFractionDigits: 3 })).toBe(
      '₦500.000'
    );
  });

  it('derives defaults from the effective notation', () => {
    expect(formatMoneyCompact(1200, 'NGN', { notation: 'standard' })).toBe(
      '₦1,200.00'
    );
    expect(formatMoneyCompact(500, 'NGN', { notation: 'compact' })).toBe(
      '₦500.0'
    );
  });

  it('ignores rogue and explicitly-undefined notation options', () => {
    const rogue = {
      notation: 'scientific',
    } as unknown as FormatMoneyCompactOptions;
    expect(formatMoneyCompact(1200, 'NGN', rogue)).toBe('₦1.2K');
    expect(formatMoneyCompact(1_200_000, 'NGN', { notation: undefined })).toBe(
      '₦1.2M'
    );
  });

  it('equalizes fraction bounds for roundingIncrement > 1', () => {
    const options = { roundingIncrement: 5 } as FormatMoneyCompactOptions;
    expect(formatMoneyCompact(1200, 'NGN', options)).toBe('₦1.20K');
  });

  it('keeps magnitude precision in compact zero-decimal amounts', () => {
    // Compact fractions describe the abbreviated magnitude (1,5 M),
    // not minor units, so zero-decimal currencies keep them; the
    // standard branch (500.5 XAF pin above) stays whole.
    expect(formatMoneyCompact(500, 'XOF', { notation: 'compact' })).toBe(
      `500,0${NBSP}F${NNBSP}CFA`
    );
    expect(formatMoneyCompact(1_500_000, 'XOF')).toBe(
      `1,5${NBSP}M${NBSP}F${NNBSP}CFA`
    );
    // A lone bound also resolves against compact magnitude defaults,
    // not the zero minor-unit exponent.
    expect(
      formatMoneyCompact(1_500_000, 'XOF', { minimumFractionDigits: 0 })
    ).toBe(`1,5${NBSP}M${NBSP}F${NNBSP}CFA`);
  });
});

import { describe, expect, it } from 'vitest';
import {
  isTokenBackfillTab,
  isUtilityBackfillTab,
} from './utility-voucher-backfill-tabs';

describe('isUtilityBackfillTab', () => {
  it('covers every utility tab (telco rides along for settlement)', () => {
    expect(isUtilityBackfillTab('power')).toBe(true);
    expect(isUtilityBackfillTab('tv')).toBe(true);
    expect(isUtilityBackfillTab('betting')).toBe(true);
    expect(isUtilityBackfillTab('airtime')).toBe(true);
    expect(isUtilityBackfillTab('data')).toBe(true);
    expect(isUtilityBackfillTab('nope')).toBe(false);
  });
});

describe('isTokenBackfillTab', () => {
  it('covers only the bill tabs whose success may gain a late token', () => {
    expect(isTokenBackfillTab('power')).toBe(true);
    expect(isTokenBackfillTab('tv')).toBe(true);
    expect(isTokenBackfillTab('betting')).toBe(true);
    expect(isTokenBackfillTab('airtime')).toBe(false);
    expect(isTokenBackfillTab('data')).toBe(false);
    expect(isTokenBackfillTab('nope')).toBe(false);
  });
})
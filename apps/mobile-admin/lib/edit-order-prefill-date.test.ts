import { describe, expect, it } from 'vitest';
import { resolvePrefillDate } from './edit-order-prefill-date';

describe('resolvePrefillDate', () => {
  it('prefers the stored day for manual sources', () => {
    expect(
      resolvePrefillDate({
        invoiceDay: '2024-01-05',
        savedInstant: new Date(2024, 0, 4, 23, 30).toISOString(),
        source: 'physical',
      })?.getTime()
    ).toBe(new Date(2024, 0, 5).getTime());
  });

  it('falls back to the instant for manual sources without a stored day', () => {
    const savedInstant = '2024-01-02T10:00:00.000Z';

    expect(
      resolvePrefillDate({
        invoiceDay: null,
        savedInstant,
        source: 'manual',
      })?.toISOString()
    ).toBe(savedInstant);
  });

  it('uses the instant for non-manual sources', () => {
    const savedInstant = '2024-01-02T10:00:00.000Z';

    expect(
      resolvePrefillDate({
        invoiceDay: '2024-01-05',
        savedInstant,
        source: 'website',
      })?.toISOString()
    ).toBe(savedInstant);
  });

  it('returns undefined for unparseable input', () => {
    expect(
      resolvePrefillDate({
        invoiceDay: 'not-a-day',
        savedInstant: 'not-a-date',
        source: 'manual',
      })
    ).toBeUndefined();
    expect(resolvePrefillDate({})).toBeUndefined();
  });
});

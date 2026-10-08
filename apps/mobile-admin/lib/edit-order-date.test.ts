import { describe, expect, it } from 'vitest';
import { resolveEditOrderDate, resolvePrefillDate } from './edit-order-date';

describe('resolveEditOrderDate', () => {
  it('omits the date when there is no saved order', () => {
    const currentDate = new Date('2024-01-02T10:00:00.000Z');

    expect(
      resolveEditOrderDate({ currentDate, hasSavedOrder: false })
    ).toBeUndefined();
  });

  it('omits the date when the saved date is missing or unparseable', () => {
    const currentDate = new Date(2024, 0, 5, 18, 30);

    expect(
      resolveEditOrderDate({ currentDate, hasSavedOrder: true })
    ).toBeUndefined();
    expect(
      resolveEditOrderDate({
        currentDate,
        hasSavedOrder: true,
        savedCreatedAt: 'not-a-date',
      })
    ).toBeUndefined();
  });

  it('omits the date when the calendar day is unchanged', () => {
    const currentDate = new Date(2024, 0, 2, 18, 30);

    expect(
      resolveEditOrderDate({
        currentDate,
        hasSavedOrder: true,
        savedTransactionDate: new Date(2024, 0, 2, 10, 0).toISOString(),
      })
    ).toBeUndefined();
  });

  it('normalizes a changed day to local midnight', () => {
    const resolved = resolveEditOrderDate({
      currentDate: new Date(2024, 0, 5, 18, 30),
      hasSavedOrder: true,
      savedTransactionDate: new Date(2024, 0, 2, 10, 0).toISOString(),
    });

    expect(resolved?.getTime()).toBe(new Date(2024, 0, 5).getTime());
  });

  it('compares manual orders against the stored explicit day', () => {
    expect(
      resolveEditOrderDate({
        currentDate: new Date(2024, 0, 5, 18, 30),
        hasSavedOrder: true,
        savedDay: '2024-01-05',
        savedSource: 'physical',
        savedTransactionDate: new Date(2024, 0, 4, 23, 30).toISOString(),
      })
    ).toBeUndefined();

    const resolved = resolveEditOrderDate({
      currentDate: new Date(2024, 0, 6, 9, 15),
      hasSavedOrder: true,
      savedDay: '2024-01-05',
      savedSource: 'physical',
      savedTransactionDate: new Date(2024, 0, 5, 10, 0).toISOString(),
    });
    expect(resolved?.getTime()).toBe(new Date(2024, 0, 6).getTime());
  });

  it('ignores manual comparison when the stored day is missing', () => {
    expect(
      resolveEditOrderDate({
        currentDate: new Date(2024, 0, 2, 18, 30),
        hasSavedOrder: true,
        savedSource: 'physical',
        savedTransactionDate: new Date(2024, 0, 2, 10, 0).toISOString(),
      })
    ).toBeUndefined();
  });
});

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

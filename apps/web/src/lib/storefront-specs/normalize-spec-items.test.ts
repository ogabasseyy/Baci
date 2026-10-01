import { describe, expect, it } from 'vitest';
import { normalizeSpecItems } from './normalize-spec-items';

describe('normalizeSpecItems', () => {
  it('normalizes scalar values and removes malformed spec rows', () => {
    expect(
      normalizeSpecItems([
        { label: ' Resolution ', value: ' <strong>1080p</strong> ' },
        { label: 'Numeric', value: 30 },
        { label: '', value: 'ignored' },
        null,
      ])
    ).toEqual([
      { label: 'Resolution', value: '1080p' },
      { label: 'Numeric', value: '30' },
    ]);
  });

  it('keeps the first value for duplicate canonical labels', () => {
    expect(
      normalizeSpecItems([
        { label: ' RAM ', value: '8GB' },
        { label: 'ram', value: '12GB' },
        { label: 'Internal Storage', value: '256GB' },
        { label: 'storage', value: '512GB' },
      ])
    ).toEqual([
      { label: 'RAM', value: '8GB' },
      { label: 'Internal Storage', value: '256GB' },
    ]);
  });

  it('retains explicit negative capability rows for category-aware filtering', () => {
    expect(normalizeSpecItems([{ label: 'Card Slot', value: 'No' }])).toEqual([
      { label: 'Card Slot', value: 'No' },
    ]);
  });

  it('prefers a later supported value over an earlier placeholder for the same canonical label', () => {
    const items = [
      { label: 'Card Slot', value: 'N/A' },
      { label: 'Memory Card Slot', value: 'CFexpress Type B' },
    ];

    const result = normalizeSpecItems(items);

    expect(result).toEqual([
      { label: 'Memory Card Slot', value: 'CFexpress Type B' },
    ]);
  });

  it('treats a later explicit No capability as stronger evidence than N/A', () => {
    const items = [
      { label: 'Card Slot', value: 'N/A' },
      { label: 'Card Slot', value: 'No' },
    ];

    const result = normalizeSpecItems(items);

    expect(result).toEqual([{ label: 'Card Slot', value: 'No' }]);
  });
});

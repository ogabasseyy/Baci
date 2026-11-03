import { describe, expect, it } from 'vitest';
import capture from './fixtures/petrock-esim-1941-20261030.json';
import { parsePetrockReplay } from './petrock-parser';

describe('captured product 1941 eSIM response', () => {
  it('preserves captured eSIM support and extracts the explicit Apple model token', () => {
    expect(parsePetrockReplay(capture.replay)).toMatchObject({
      device: 'APPLE_A3525_IPHONE 17 PRO MAX_IPHONE 17 PRO MAX (CANADA-JP)',
      modelNumber: 'A3525',
      esimCompatibility: 'Yes',
      blacklistStatus: 'Unknown',
      verdictType: 'caution',
    });
  });

  it('prefers an explicit model number over the embedded supplier token', () => {
    expect(
      parsePetrockReplay(`${capture.replay}<br>Model Number: A1234`).modelNumber
    ).toBe('A1234');
  });

  it.each([
    'iPhone 17 Pro Max',
    'SAMSUNG_A3525_GALAXY',
    'APPLE_A352_IPHONE',
    'APPLE_A35250_IPHONE',
    'NOTAPPLE_A3525_IPHONE',
  ])('does not invent a model number from %s', (model) => {
    expect(parsePetrockReplay(`Model: ${model}`).modelNumber).toBe('');
  });

  it('keeps the regression fixture free of device and order identifiers', () => {
    const serialized = JSON.stringify(capture);
    expect(serialized).not.toMatch(/\d{15}/);
    expect(serialized).not.toMatch(
      /IMEI Number:|Serial Number:|order_uuid|reference_id|Bearer /i
    );
  });
});

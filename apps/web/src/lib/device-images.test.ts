import { describe, expect, it } from 'vitest';
import { getDeviceImage } from './device-images';

describe('getDeviceImage', () => {
  it.each([
    '',
    'iPhone 17 Pro Max 512GB Silver',
    'Unknown device',
  ])('uses the existing icon fallback for unmapped model %s', (model) =>
    expect(getDeviceImage(model)).toBe(''));
  it('keeps the mapped model image', () => {
    expect(getDeviceImage('iPhone 15 Pro Max 256GB')).toContain(
      'iphone-15-pro-finish-select-202309-6-7inch-naturaltitanium'
    );
  });
});

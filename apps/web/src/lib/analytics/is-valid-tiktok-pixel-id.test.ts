import { expect, it } from 'vitest';
import { isValidTikTokPixelId } from './is-valid-tiktok-pixel-id';

it('accepts bounded alphanumeric IDs and rejects executable or invalid values', () => {
  expect(isValidTikTokPixelId('TT123')).toBe(true);
  for (const value of ['', "x');alert(1)//", 'x'.repeat(65), 'bad-id'])
    expect(isValidTikTokPixelId(value)).toBe(false);
});

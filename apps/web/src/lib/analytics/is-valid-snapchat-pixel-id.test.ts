import { expect, it } from 'vitest';
import { isValidSnapchatPixelId } from './is-valid-snapchat-pixel-id';

it('accepts UUID-shaped IDs and rejects malformed values', () => {
  expect(isValidSnapchatPixelId('11111111-1111-4111-8111-111111111111')).toBe(
    true
  );
  expect(isValidSnapchatPixelId('invalid')).toBe(false);
});

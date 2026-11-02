import { expect, it } from 'vitest';
import { mediaDeletionIdentitySchema } from './media-deletion';

it.each([
  '../../file.webp',
  '/etc/passwd',
  'file%2f.webp',
  'file.webp?id=foreign',
])('rejects a noncanonical deletion identity %s', (input) => {
  expect(mediaDeletionIdentitySchema.safeParse(input).success).toBe(false);
});
it('accepts opaque object UUIDs and legacy bare filenames', () => {
  expect(
    mediaDeletionIdentitySchema.safeParse(
      '36690000-0000-4000-8000-000000000002'
    ).success
  ).toBe(true);
  expect(mediaDeletionIdentitySchema.safeParse('1234-file.webp').success).toBe(
    true
  );
});

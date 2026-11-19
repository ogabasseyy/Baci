import { expect, it } from 'vitest';
import { experienceAssetSchema } from './experience-assets';

it('asset API refuses URL fetches/SVG and extra credential fields', () => {
  expect(
    experienceAssetSchema.safeParse({
      mime: 'image/svg+xml',
      bytes: new Uint8Array(1),
      alt: 'x',
    }).success
  ).toBe(false);
  expect(
    experienceAssetSchema.safeParse({
      mime: 'image/png',
      bytes: new Uint8Array(1),
      alt: 'x',
      url: 'https://external.invalid',
    }).success
  ).toBe(false);
});

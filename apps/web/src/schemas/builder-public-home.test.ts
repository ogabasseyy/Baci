import { expect, it } from 'vitest';
import {
  builderPublicContentDigestSchema,
  builderPublicHomeSchema,
} from './builder-public-home';

it('requires the public version paired with a config and rejects private extra fields', () => {
  const result = {
    config: { title: 'Live' },
    publishedVersion: 'published:10000000-0000-4000-8000-000000000001',
  };
  expect(builderPublicHomeSchema.parse(result)).toEqual(result);
  expect(
    builderPublicHomeSchema.safeParse({
      ...result,
      pendingConfig: { title: 'private' },
    }).success
  ).toBe(false);
  expect(
    builderPublicHomeSchema.safeParse({
      ...result,
      publishedVersion: 'draft:1',
    }).success
  ).toBe(false);
});
it('accepts only the canonical content digest algorithm and full hash', () => {
  expect(
    builderPublicContentDigestSchema.parse(`home-v1:${'a'.repeat(64)}`)
  ).toContain('home-v1:');
  for (const input of [
    'a'.repeat(64),
    'home-v1:abc',
    `home-v2:${'a'.repeat(64)}`,
  ])
    expect(builderPublicContentDigestSchema.safeParse(input).success).toBe(
      false
    );
});

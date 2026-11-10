import { expect, it } from 'vitest';
import { compiledCandidateSchema } from './experience-compiled-candidate';

it('accepts compiled bundles with or without a host origin', () => {
  const bundle = {
    javascript: 'export {}',
    css: '',
    digest: 'a'.repeat(64),
    imports: [],
  };
  expect(compiledCandidateSchema.parse(bundle)).toEqual(bundle);
  expect(
    compiledCandidateSchema.safeParse({
      ...bundle,
      hostOrigin: 'https://shop.test',
    }).success
  ).toBe(true);
});

it('rejects malformed and oversized fields and unknown properties', () => {
  const bundle = {
    javascript: 'export {}',
    css: '',
    digest: 'a'.repeat(64),
    imports: [],
  };
  for (const patch of [
    { hostOrigin: 'invalid' },
    { javascript: '' },
    { css: null },
    { digest: 'A'.repeat(64) },
    { imports: ['x'.repeat(513)] },
    { imports: Array.from({ length: 4097 }, () => 'source:app') },
    { verified: true },
  ])
    expect(
      compiledCandidateSchema.safeParse({ ...bundle, ...patch }).success
    ).toBe(false);
});

import { expect, it } from 'vitest';
import {
  experiencePublicOutputFile,
  experiencePublicPrerenderBinding,
} from './experience-public-output';

const id = '11111111-1111-4111-8111-111111111111';
const digest = 'a'.repeat(64);
it('admits only bounded public output files with exact digest, MIME and hex fields', () => {
  const file = { path: 'app.js', digest, mime: 'text/javascript', hex: '00ff' };
  expect(experiencePublicOutputFile.parse(file)).toEqual(file);
  for (const invalid of [
    { ...file, path: 'x'.repeat(129) },
    { ...file, digest: 'bad' },
    { ...file, mime: 'text/html' },
    { ...file, hex: 'f' },
    { ...file, hex: 'zz' },
    { ...file, privateField: true },
  ])
    expect(experiencePublicOutputFile.safeParse(invalid).success).toBe(false);
});
it('validates all prerender publication bindings and rejects extra authority', () => {
  const binding = {
    merchantId: id,
    buildId: id,
    buildDigest: digest,
    sourceDigest: digest,
  };
  expect(experiencePublicPrerenderBinding.parse(binding)).toEqual(binding);
  for (const key of Object.keys(binding))
    expect(
      experiencePublicPrerenderBinding.safeParse({ ...binding, [key]: 'bad' })
        .success
    ).toBe(false);
  expect(
    experiencePublicPrerenderBinding.safeParse({ ...binding, approved: true })
      .success
  ).toBe(false);
});

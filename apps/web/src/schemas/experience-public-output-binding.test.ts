import { expect, it } from 'vitest';
import {
  publicFrameBinding,
  publicOutputBinding,
} from './experience-public-output-binding';

it('shares the frame binding and validates delivery asset keys and hashes', () => {
  const digest = 'a'.repeat(64);
  const frame = {
    slug: 'synthetic',
    canonicalBase: 'https://shop.example.com',
    buildDigest: digest,
    scriptDigest: digest,
    styleDigest: digest,
  };
  const output = { ...frame, assets: { logo: digest } };
  expect(publicFrameBinding.parse(output)).toEqual(frame);
  expect(publicOutputBinding.parse(output)).toEqual(output);
  expect(
    publicFrameBinding.safeParse({ ...frame, buildDigest: 'bad' }).success
  ).toBe(false);
  expect(
    publicOutputBinding.safeParse({ ...output, assets: { 'Logo PNG': digest } })
      .success
  ).toBe(false);
});

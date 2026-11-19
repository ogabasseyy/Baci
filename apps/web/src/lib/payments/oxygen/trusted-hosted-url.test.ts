import { expect, it } from 'vitest';
import { isTrustedOxygenHostedUrl } from './trusted-hosted-url';

it('accepts only exact configured HTTPS origins without credentials or nondefault ports', () => {
  const origins = ['https://hosted.example.test'];
  expect(
    isTrustedOxygenHostedUrl(
      'https://hosted.example.test/path?token=test',
      origins
    )
  ).toBe(true);
  for (const value of [
    'https://hosted.example.test.evil.test/path',
    'http://hosted.example.test',
    'https://user@hosted.example.test',
    'https://hosted.example.test:444',
    'javascript:alert(1)',
    'not a url',
  ])
    expect(isTrustedOxygenHostedUrl(value, origins)).toBe(false);
  expect(isTrustedOxygenHostedUrl('https://hosted.example.test', [])).toBe(
    false
  );
});

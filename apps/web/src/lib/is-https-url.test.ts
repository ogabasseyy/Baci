import { describe, expect, it } from 'vitest';
import { isHttpsUrl } from '@/lib/is-https-url';

describe('isHttpsUrl', () => {
  it.each([
    'https://cdn.example.com/image.webp',
    'https://example.com:8443/path?q=1',
  ])('accepts absolute HTTPS URLs: %s', (value) => {
    expect(isHttpsUrl(value)).toBe(true);
  });

  it.each([
    'http://example.com/image.png',
    '//example.com/image.png',
    'assets/photo.png',
    '/relative/photo.png',
    'not a url',
    '',
    null,
    undefined,
    123,
  ])('rejects non-HTTPS values: %s', (value) => {
    expect(isHttpsUrl(value)).toBe(false);
  });
});

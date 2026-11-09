import { afterEach, expect, it, vi } from 'vitest';
import { selfieLinkExpiration, selfieLinkExpired } from './selfie-link-expired';

afterEach(() => vi.useRealTimers());

function link(payload: unknown) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `https://selfie.example.test/?securityToken=x.${encoded}.x`;
}

it('treats a token exp at or before the current second as expired', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  const now = Date.now() / 1000;
  expect(selfieLinkExpired(link({ exp: now }))).toBe(true);
  expect(selfieLinkExpired(link({ exp: now - 1 }))).toBe(true);
  expect(selfieLinkExpired(link({ exp: now + 1 }))).toBe(false);
});

it.each([
  'not a URL',
  'https://selfie.example.test/',
  'https://selfie.example.test/?securityToken=x.bad.x',
])('does not infer expiry from malformed or missing data: %s', (url) => {
  expect(selfieLinkExpired(url)).toBe(false);
});

it('does not accept a nonnumeric expiry', () => {
  expect(selfieLinkExpired(link({ exp: '1' }))).toBe(false);
});

it.each([0, 1.25, -1])('accepts finite NumericDate %s', (exp) => {
  const url = `https://selfie.example/?securityToken=a.${btoa(JSON.stringify({ exp }))}.c`;
  expect(selfieLinkExpiration(url)).toBe(exp * 1000);
});

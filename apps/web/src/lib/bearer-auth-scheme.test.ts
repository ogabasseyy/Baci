import { expect, it } from 'vitest';
import { hasBearerAuthScheme } from './bearer-auth-scheme';

it.each([
  'Bearer',
  'Bearer token',
  'bEaReR token',
])('recognizes a Bearer attempt even when it carries no token: %s', (authorization) => {
  const request = new Request('https://example.com', {
    headers: { authorization },
  });
  expect(hasBearerAuthScheme(request)).toBe(true);
});

it.each([
  '',
  'Basic credential',
  'BearerOther token',
])('does not classify absent credentials or a different scheme as Bearer: %s', (authorization) => {
  const request = new Request('https://example.com', {
    headers: authorization ? { authorization } : {},
  });
  expect(hasBearerAuthScheme(request)).toBe(false);
});

import { expect, it } from 'vitest';
import { publicFrameworkRequest } from './public-framework-request';

it('accepts only canonical same-origin Next framework assets', () => {
  const origin = 'https://shop.example.com';
  expect(
    publicFrameworkRequest(origin, {
      url: `${origin}/_next/static/chunks/a.js?dpl=abc-1`,
      method: 'GET',
    })
  ).toBe('js');
  expect(
    publicFrameworkRequest(origin, {
      url: `${origin}/_next/static/css/a.css`,
      method: 'GET',
    })
  ).toBe('css');
  for (const request of [
    { url: 'https://other.example/_next/static/a.js', method: 'GET' },
    { url: `${origin}/_next/static/%61.js`, method: 'GET' },
    { url: `${origin}/_next/static/a.js?secret=x`, method: 'GET' },
    { url: `${origin}/_next/static/a.js`, method: 'POST' },
    { url: `${origin}/api/orders`, method: 'GET' },
    { url: `${origin}/_next/static/a.js`, method: 'GET', body: '{}' },
  ])
    expect(publicFrameworkRequest(origin, request)).toBeNull();
});

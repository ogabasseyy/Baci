import { expect, it } from 'vitest';
import { parseBrilStashHttpsUrl } from './parse-https-url';

it('accepts an absolute HTTPS URL with query and fragment intact', () => {
  const value = 'https://shop.example.invalid/phone?condition=new#details';
  expect(parseBrilStashHttpsUrl(value)?.href).toBe(value);
});

it.each([
  'http://shop.example.invalid',
  '//shop.example.invalid',
  'https://user@shop.example.invalid',
  'https://:password@shop.example.invalid',
  'https://shop.example.invalid:65536',
  'https://shop.example.invalid/white space',
  'https://shop.example.invalid\\path',
])('rejects an unsupported URL %s', (value) => {
  expect(parseBrilStashHttpsUrl(value)).toBeNull();
});

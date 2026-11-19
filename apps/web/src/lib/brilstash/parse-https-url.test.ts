import { expect, it } from 'vitest';
import {
  brilStashImageUrlKey,
  parseBrilStashHttpsUrl,
} from './parse-https-url';

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

it('normalizes verified image authorities without modifying the path or query', () => {
  expect(
    brilStashImageUrlKey('https://CDN.example.invalid:00443?width=42')
  ).toBe('https://cdn.example.invalid/?width=42');
  expect(
    brilStashImageUrlKey('https://CDN.example.invalid:8443/file.jpg')
  ).toBe('https://cdn.example.invalid:8443/file.jpg');
});

it('uses the same key for an image on a trailing-dot DNS hostname', () => {
  expect(brilStashImageUrlKey('https://CDN.example.invalid.:443/p.jpg')).toBe(
    brilStashImageUrlKey('https://cdn.example.invalid/p.jpg')
  );
});

it.each([
  'https://cdn.example.invalid:0/image.jpg',
  'https://cdn.example.invalid:00000/image.jpg',
  'https://cdn.example.invalid:65536/image.jpg',
  'https://user@cdn.example.invalid/image.jpg',
  'https://cdn.example.invalid/image.jpg#crop',
  'https://-cdn.example.invalid/image.jpg',
])('rejects an unsupported verified image URL %s', (value) => {
  expect(brilStashImageUrlKey(value)).toBeNull();
});

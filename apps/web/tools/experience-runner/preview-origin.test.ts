import { expect, it } from 'vitest';
import { localPreviewHost } from './preview-origin';

it('accepts configured loopback parents while rejecting remote, credentialed or execution origins', () => {
  expect(localPreviewHost('http://localhost:3000')).toBe(
    'http://localhost:3000'
  );
  for (const value of [
    'https://remote.invalid',
    'http://user:pass@localhost:3000',
    'http://127.0.0.1:4101',
    'http://localhost:3000/path',
  ])
    expect(() => localPreviewHost(value)).toThrow();
});

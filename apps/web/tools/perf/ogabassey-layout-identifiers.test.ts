import { expect, it } from 'vitest';
import {
  validRoutePath,
  validStoreIdentifier,
} from './ogabassey-layout-identifiers';

it('validates store identifiers and route segments', () => {
  expect(validStoreIdentifier('ogabassey.com')).toBe(true);
  expect(validStoreIdentifier('../other')).toBe(false);
  expect(validRoutePath('products/phone')).toBe(true);
  for (const route of [
    '../secret',
    'products/%2fsecret',
    'products/%00',
    '%ZZ',
  ]) {
    expect(validRoutePath(route)).toBe(false);
  }
});

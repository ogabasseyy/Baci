import { expect, it } from 'vitest';
import {
  productionDeliveryOrigins,
  productionOrigin,
} from './production-origins';

it('requires HTTPS origins and a distinct execution registrable site', () => {
  expect(
    productionDeliveryOrigins({
      executionOrigin: 'https://execution.example.net',
      hostOrigins: ['https://shop.example.com'],
    })
  ).toEqual({
    executionOrigin: 'https://execution.example.net',
    hostOrigins: ['https://shop.example.com'],
  });
  expect(() =>
    productionDeliveryOrigins({
      executionOrigin: 'https://execution.example.com',
      hostOrigins: ['https://shop.example.com'],
    })
  ).toThrow('EXECUTION_SITE_MUST_BE_ISOLATED');
  for (const input of [
    'http://shop.example.com',
    'https://user:pass@example.com',
    'https://shop.example.com/path',
    'https://localhost',
    'https://shop.example.com/',
  ])
    expect(() => productionOrigin(input)).toThrow();
});

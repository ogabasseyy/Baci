import { describe, expect, it } from 'vitest';
import { brilStashBuilderInputSchema } from './brilstash-builder-input';

const target = {
  installationId: '70000000-0000-4000-8000-000000000001',
  merchantId: '80000000-0000-4000-8000-000000000001',
};

describe('BrilStash builder input', () => {
  it('accepts a canonical HTTPS origin', () => {
    expect(
      brilStashBuilderInputSchema.safeParse({
        ...target,
        storefrontOrigin: 'https://shop.example.invalid',
      }).success
    ).toBe(true);
  });

  it.each([
    'http://shop.example.invalid',
    'https://user:password@shop.example.invalid',
    'https://shop.example.invalid/products',
    'https://shop.example.invalid/',
    'https://shop.example.invalid?q=1',
    'https://shop.example.invalid#products',
  ])('rejects a noncanonical storefront origin %s', (storefrontOrigin) => {
    expect(
      brilStashBuilderInputSchema.safeParse({ ...target, storefrontOrigin })
        .success
    ).toBe(false);
  });
});

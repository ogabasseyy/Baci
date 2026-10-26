import { describe, expect, it } from 'vitest';
import {
  catalog,
  home,
  merchant,
} from '../../tools/builder-preview-spike/fixtures';
import {
  portableCatalogSchema,
  portableHomeSchema,
  portableIdentitySchema,
} from './portable-storefront';

const destinations = [
  (url: string) => ({
    type: 'Header',
    props: { id: 'h', navigationLinks: [{ label: 'Shop', url }] },
  }),
  (url: string) => ({
    type: 'Hero',
    props: { id: 'h', title: 'Hero', ctaLink: url },
  }),
  (url: string) => ({
    type: 'Button',
    props: { id: 'b', text: 'Shop', link: url },
  }),
  (url: string) => ({
    type: 'Footer',
    props: {
      id: 'f',
      copyrightText: 'Store',
      quickLinks: [{ label: 'Shop', url }],
    },
  }),
];
const unsafe = [
  '/\\evil.example/phish',
  '//evil.example/phish',
  '/../other-store',
  '/products/../../other-store',
  '/./products',
  '/%2e%2e/other-store',
  '/%252e%252e/other-store',
  '/%2F%2Fevil.example',
  '/%252f%252fevil.example',
  '/%5cevil.example',
  '/%255cevil.example',
  '/products%2fcamera',
  '/products%252fcamera',
  '/products\n/other-store',
  '/products\t/other-store',
  '/%0a/other-store',
  '/%2509/other-store',
  'https://evil.example',
  '/%2e./other-store',
  '/.%252e/other-store',
];

describe('portable same-store paths', () => {
  it.each(
    unsafe
  )('rejects escaping destination %j in every destination field', (url) => {
    for (const destination of destinations)
      expect(
        portableHomeSchema.safeParse({ ...home, content: [destination(url)] })
          .success
      ).toBe(false);
  });
  it.each([
    '/',
    '/products',
    '/products/camera?color=blue&sort=price#details',
    '/search?q=camera%20bag&return=%2Fproducts',
    '/search?q=https%3A%2F%2Fexample.test%2Fa',
    '/products/caf%C3%A9',
    '/products/café',
    '/search?q=100%25&next=%252Fproducts',
    '/products/a.b',
    '/products/100%25',
  ])('preserves valid same-store destination %j', (url) => {
    for (const destination of destinations) {
      const result = portableHomeSchema.safeParse({
        ...home,
        content: [destination(url)],
      });
      expect(result.success).toBe(true);
    }
  });
  it.each([
    '..',
    '.',
    '../other-store',
    '\\evil.example',
    '%2e%2e',
    '%252fother-store',
    'camera\n',
  ])('rejects unsafe merchant/product slug %j', (slug) => {
    expect(
      portableIdentitySchema.safeParse({ ...merchant, slug }).success
    ).toBe(false);
    expect(
      portableCatalogSchema.safeParse({
        ...catalog,
        products: [{ ...catalog.products[0], slug }],
      }).success
    ).toBe(false);
  });
});

import { expect, it } from 'vitest';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { buildDiscoveryFactRetrievalQuery } from './build-discovery-fact-retrieval-query';

const intent = (...alternatives: McpDiscoveryIntent['alternatives']): McpDiscoveryIntent => ({ alternatives });

it('builds grouped tsquery text with brand alternation', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({
    product_type: 'phone', brands: ['Samsung', 'Google'],
    attributes: [{ key: 'storage_gb', operator: 'eq', value: 256 }],
  }))).toBe('(((phone) | (phones) | (smartphone) | (smartphones) | (smart & phone) | (smart & phones) | (mobile & phone) | (mobile & phones) | (cell & phone) | (cell & phones)) & (samsung | google) & storage256gb)');
});

it('joins alternatives with OR and strips tsquery operators from terms', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: 'ZX-42' }, { product_type: 'charger' })))
    .toBe('(zx & 42) | (((charger) | (chargers)))');
});

it('groups multi-word brand phrases with AND before OR-ing across brands', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ brands: ['Hewlett Packard', 'Dell'] })))
    .toBe('(((hewlett & packard) | dell))');
  expect(buildDiscoveryFactRetrievalQuery(intent({ brands: ['Samsung Galaxy'] }))).toBe('((samsung & galaxy))');
});

it('retrieves every spelling selection treats as the same type', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ product_type: 'Smartphones' })))
    .toBe('(((phone) | (phones) | (smartphone) | (smartphones) | (smart & phone) | (smart & phones) | (mobile & phone) | (mobile & phones) | (cell & phone) | (cell & phones)))');
  expect(buildDiscoveryFactRetrievalQuery(intent({ product_type: 'headphones' }))).toBe('(headphones)');
});

it('emits unit-suffixed equality values and unit lexemes for ranges', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [
    { key: 'power_w', operator: 'eq', value: 30 },
    { key: 'storage_gb', operator: 'gte', value: 256 },
    { key: 'color', operator: 'eq', value: 'black' },
  ] }))).toBe('(power30w & storagegb & fact2da864cb0599c70b188812c7ee944b96ef701cc392e9ce63531c4b56dd89fde5)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [
    { key: 'connector', operator: 'eq', value: 'USB-C' },
  ] }))).toBe('(fact0799a4fe78453e262b104ae43eeede491f19b6d3f98c8be2525f29fb1d059548)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [
    { key: 'ram_gb', operator: 'gte', value: 16 },
  ] }))).toBe('(ramgb)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [
    { key: 'color', operator: 'gte', value: 'black' },
  ] }))).toBe('(a & !a)');
});

it('hashes text attribute pairs with the selector normalization and keeps keys correlated', () => {
  const query = (key: 'connector' | 'color', value: string) =>
    buildDiscoveryFactRetrievalQuery(intent({ attributes: [{ key, operator: 'eq', value }] }));
  expect(query('connector', '  Usb-C  ')).toBe('(fact0799a4fe78453e262b104ae43eeede491f19b6d3f98c8be2525f29fb1d059548)');
  expect(query('connector', 'USB-C')).toBe(query('connector', '  Usb-C  '));
  expect(query('color', 'USB-C')).not.toBe(query('connector', 'USB-C'));
  expect(query('connector', 'Cafe\u0301')).toBe(query('connector', 'Café'));
});

it('keeps equal numeric values distinct by attribute identity', () => {
  const query = buildDiscoveryFactRetrievalQuery(intent({ attributes: [
    { key: 'ram_gb', operator: 'eq', value: 8 },
    { key: 'storage_gb', operator: 'eq', value: 8 },
  ] }));
  expect(query).toBe('(ram8gb & storage8gb)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [
    { key: 'screen_inches', operator: 'eq', value: 15 },
    { key: 'refresh_hz', operator: 'eq', value: 120 },
  ] }))).toBe('(screen15inch & refresh120hz)');
});

it('falls back to sanitized shopper wording and never emits empty syntax', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({}), 'Samsung or Google 256GB?')).toBe('(samsung & google & 256gb)');
  expect(buildDiscoveryFactRetrievalQuery(intent({}), '!!!')).toBe('(a & !a)');
  expect(buildDiscoveryFactRetrievalQuery(intent({}))).toBe('(a & !a)');
  expect(buildDiscoveryFactRetrievalQuery(intent({}), 'or and the')).toBe('(a & !a)');
});

it('retains Unicode identity terms while stripping query operators', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ brands: ['Mömax'], model: '三星 手机 | !' })))
    .toBe('(mömax & 三星 & 手机)');
});

it('keeps every constraint in retrieval past the old twelve-term budget', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({
    product_type: 'laptop', brands: ['Acme'], model: 'ZX 42 Ultra Pro Max Plus X Y Z',
    attributes: [
      { key: 'storage_gb', operator: 'eq', value: 256 },
      { key: 'ram_gb', operator: 'gte', value: 16 },
      { key: 'color', operator: 'eq', value: 'midnight blue deep dark shade tone' },
    ],
  }))).toBe('(((laptop) | (laptops)) & acme & zx & 42 & ultra & pro & max & plus & x & y & storage256gb & ramgb & fact9d4b15b3a2abd3add7dda96fe84fa0be4bbb8666e10bb3c3fc807d7c68e9ddc8)');
});

it('keeps the maximum structured text-attribute query under the database length bound', () => {
  const attributes = Array.from({ length: 10 }, (_, index) => ({
    key: 'connector' as const,
    operator: 'eq' as const,
    value: `USB-C ${'x'.repeat(90)} ${index}`,
  }));
  const query = buildDiscoveryFactRetrievalQuery(intent(
    ...Array.from({ length: 5 }, () => ({ attributes }))
  ));
  expect(query.length).toBeLessThanOrEqual(16000);
});

it('normalizes decomposed Unicode before building retrieval terms', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: 'Cafe\u0301 Pro' }))).toBe('(café & pro)');
});

it('drops dot-only terms and strips edge dots so groups stay valid', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: '...' }))).toBe('(a & !a)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: 'ZX-42.' }))).toBe('(zx & 42)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: '1.5' }))).toBe('(1.5)');
});

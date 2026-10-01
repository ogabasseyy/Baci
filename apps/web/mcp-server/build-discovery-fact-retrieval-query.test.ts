import { expect, it } from 'vitest';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { buildDiscoveryFactRetrievalQuery } from './build-discovery-fact-retrieval-query';

const intent = (...alternatives: McpDiscoveryIntent['alternatives']): McpDiscoveryIntent => ({ alternatives });

it('builds grouped tsquery text with brand alternation', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({
    product_type: 'phone', brands: ['Samsung', 'Google'],
    attributes: [{ key: 'storage_gb', operator: 'eq', value: 256 }],
  }))).toBe('(((phone) | (phones) | (smartphone) | (smartphones) | (smart & phone) | (smart & phones) | (mobile & phone) | (mobile & phones) | (cell & phone) | (cell & phones)) & (samsung | google) & 256gb)');
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
  ] }))).toBe('(30w & gb & black)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [
    { key: 'ram_gb', operator: 'gte', value: 16 },
  ] }))).toBe('(gb)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [
    { key: 'color', operator: 'gte', value: 'black' },
  ] }))).toBe('(a & !a)');
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

it('drops dot-only terms and strips edge dots so groups stay valid', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: '...' }))).toBe('(a & !a)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: 'ZX-42.' }))).toBe('(zx & 42)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: '1.5' }))).toBe('(1.5)');
});

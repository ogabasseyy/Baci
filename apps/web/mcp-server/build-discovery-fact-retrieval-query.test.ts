import { expect, it } from 'vitest';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { buildDiscoveryFactRetrievalQuery } from './build-discovery-fact-retrieval-query';

const intent = (...alternatives: McpDiscoveryIntent['alternatives']): McpDiscoveryIntent => ({ alternatives });

it('builds grouped tsquery text with brand alternation', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({
    product_type: 'phone', brands: ['Samsung', 'Google'],
    attributes: [{ key: 'storage_gb', operator: 'eq', value: 256 }],
  }))).toBe('(phone & (samsung | google) & 256gb)');
});

it('joins alternatives with OR and strips tsquery operators from terms', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: 'ZX-42' }, { product_type: 'charger' })))
    .toBe('(zx & 42) | (charger)');
});

it('emits unit-suffixed equality values and omits range bounds', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [
    { key: 'power_w', operator: 'eq', value: 30 },
    { key: 'storage_gb', operator: 'gte', value: 256 },
    { key: 'color', operator: 'eq', value: 'black' },
  ] }))).toBe('(30w & black)');
});

it('falls back to sanitized shopper wording and never emits empty syntax', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({}), 'Samsung or Google 256GB?')).toBe('(samsung & or & google & 256gb)');
  expect(buildDiscoveryFactRetrievalQuery(intent({}), '!!!')).toBe('(a & !a)');
  expect(buildDiscoveryFactRetrievalQuery(intent({}))).toBe('(a & !a)');
});

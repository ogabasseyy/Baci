import { expect, it } from 'vitest';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { buildDiscoveryFactRetrievalQuery } from './build-discovery-fact-retrieval-query';

const intent = (...alternatives: McpDiscoveryIntent['alternatives']): McpDiscoveryIntent => ({ alternatives });

it('builds fact retrieval text from alternatives with brand OR semantics', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({
    product_type: 'phone', brands: ['Samsung', 'Google'],
    attributes: [{ key: 'storage_gb', operator: 'eq', value: 256 }],
  }))).toBe('phone Samsung OR Google 256GB');
});

it('joins alternatives with OR and sanitizes tsquery operators', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: 'ZX-42' }, { product_type: 'charger' })))
    .toBe('ZX 42 OR charger');
});

it('emits unit-suffixed equality values and omits range bounds', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [
    { key: 'power_w', operator: 'eq', value: 30 },
    { key: 'storage_gb', operator: 'gte', value: 256 },
    { key: 'color', operator: 'eq', value: 'black' },
  ] }))).toBe('30W black');
});

it('returns empty text when no alternative names a retrieval term', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({}))).toBe('');
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [{ key: 'ram_gb', operator: 'gte', value: 8 }] }))).toBe('');
});

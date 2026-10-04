import { expect, it } from 'vitest';
import { formatMcpCatalogColors } from './format-mcp-catalog-colors';

it('identifies stored colour choices separately from variant availability', () => {
  expect(formatMcpCatalogColors({colors: ['Black', 'Red'], source: 'product.color', imagesByColor: {}}))
    .toBe('**Catalog Colors:** Black, Red (stored catalog color choices; stock and specific color/storage/price pairings are unconfirmed)');
});

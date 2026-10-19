import { expect, it } from 'vitest';
import { buildMcpCatalogColorsPayload } from './build-mcp-catalog-colors-payload';

it('preserves label and image provenance with the response-specific meaning', () => {
  expect(buildMcpCatalogColorsPayload({colors: ['Blue'], source: 'product.color_images', imagesByColor: {Blue: ['https://cdn.example/blue.jpg']}}, 'Stock unconfirmed'))
    .toEqual({labels: ['Blue'], source: 'product.color_images', images_by_color: {Blue: ['https://cdn.example/blue.jpg']}, meaning: 'Stock unconfirmed'});
});

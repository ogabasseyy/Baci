import { describe, expect, it } from 'vitest';
import { generateOpenAIFeed } from './legacy-feed-generator';
import { createLegacyFeedTestFixtures } from './legacy-feed-generator.test-fixtures';

const { merchant, parseLine, product } = createLegacyFeedTestFixtures();

describe('generateOpenAIFeed identifiers', () => {
  it('uses per-variant GTIN and MPN ahead of conflicting parent identifiers', () => {
    const lines = generateOpenAIFeed(
      [
        product({
          gtin: '00000000000011',
          mpn: 'PARENT-MODEL',
          variants: [
            {
              id: 'variant-red',
              sku: 'SKU-RED',
              attributes: {
                color: 'Red',
                gtin: ' 00000000000021 ',
                mpn: ' MODEL-RED ',
              },
              stock_quantity: 1,
            },
            {
              id: 'variant-blue',
              sku: 'SKU-BLUE',
              attributes: {
                color: 'Blue',
                gtin: '00000000000022',
                mpn: 'MODEL-BLUE',
              },
              stock_quantity: 1,
            },
          ],
        }),
      ],
      merchant,
      'https://ogabassey.com'
    );

    expect(
      lines.map(parseLine).map(({ gtin, mpn }) => ({ gtin, mpn }))
    ).toEqual([
      { gtin: '00000000000021', mpn: 'MODEL-RED' },
      { gtin: '00000000000022', mpn: 'MODEL-BLUE' },
    ]);
  });

  it('omits parent GTIN and MPN when variant identifiers are absent or blank', () => {
    const lines = generateOpenAIFeed(
      [
        product({
          gtin: '00000000000011',
          mpn: 'PARENT-MODEL',
          variants: [
            {
              id: 'variant-no-identifiers',
              sku: 'SKU-RED',
              attributes: { color: 'Red' },
              stock_quantity: 1,
            },
            {
              id: 'variant-blank-identifiers',
              sku: 'SKU-BLUE',
              attributes: { gtin: '  ', mpn: '' },
              stock_quantity: 1,
            },
          ],
        }),
      ],
      merchant,
      'https://ogabassey.com'
    );

    const rows = lines.map(parseLine);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).not.toHaveProperty('gtin');
      expect(row).not.toHaveProperty('mpn');
    }
  });

  it('trims parent identifiers and ignores numeric variant collisions', () => {
    const lines = generateOpenAIFeed(
      [
        product({
          gtin: ' 00000000000011 ',
          mpn: ' PARENT-MPN ',
          variants: [
            {
              id: 'variant-numeric-collision',
              sku: 'SKU-RED',
              attributes: {
                gtin: ' VARIANT-GTIN ',
                ' GTIN ': 123,
                mpn: false,
              } as unknown as Record<string, string>,
              stock_quantity: 1,
            },
            {
              id: 'variant-numeric-only',
              sku: 'SKU-BLUE',
              attributes: { gtin: 123 } as unknown as Record<string, string>,
              stock_quantity: 1,
            },
            {
              id: 'variant-gtin-only',
              sku: 'SKU-GTIN',
              attributes: { gtin: 'VARIANT-GTIN-ONLY' },
              stock_quantity: 1,
            },
            {
              id: 'variant-mpn-only',
              sku: 'SKU-MPN',
              attributes: { mpn: 'VARIANT-MPN-ONLY' },
              stock_quantity: 1,
            },
          ],
        }),
        product({ gtin: '  ', mpn: '\t' }),
        product({ gtin: ' PARENT-GTIN ', mpn: ' PARENT-MPN ' }),
      ],
      merchant,
      'https://ogabassey.com'
    );

    const rows = lines.map(parseLine);
    expect(rows.map(({ gtin, mpn }) => ({ gtin, mpn }))).toEqual([
      { gtin: 'VARIANT-GTIN', mpn: undefined },
      { gtin: undefined, mpn: undefined },
      { gtin: 'VARIANT-GTIN-ONLY', mpn: undefined },
      { gtin: undefined, mpn: 'VARIANT-MPN-ONLY' },
      { gtin: undefined, mpn: undefined },
      { gtin: 'PARENT-GTIN', mpn: 'PARENT-MPN' },
    ]);
    for (const row of rows.slice(0, 5)) {
      if (row.gtin === undefined) {
        expect(row).not.toHaveProperty('gtin');
      }
      if (row.mpn === undefined) {
        expect(row).not.toHaveProperty('mpn');
      }
    }
  });
});

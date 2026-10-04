import { describe, expect, it } from 'vitest';
import { generateOpenAIFeed } from './legacy-feed-generator';
import {
  merchant,
  parseLine,
  product,
} from './legacy-feed-generator.test-fixtures';

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

  it('falls back to parent GTIN and MPN when variant identifiers are absent or blank', () => {
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

    expect(
      lines.map(parseLine).map(({ gtin, mpn }) => ({ gtin, mpn }))
    ).toEqual([
      { gtin: '00000000000011', mpn: 'PARENT-MODEL' },
      { gtin: '00000000000011', mpn: 'PARENT-MODEL' },
    ]);
  });

  it('trims parent identifiers and ignores numeric variant collisions', () => {
    const lines = generateOpenAIFeed(
      [
        product({
          gtin: ' 00000000000011 ',
          mpn: '   ',
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
          ],
        }),
        product({ gtin: '  ', mpn: '\t' }),
      ],
      merchant,
      'https://ogabassey.com'
    );

    expect(
      lines.map(parseLine).map(({ gtin, mpn }) => ({ gtin, mpn }))
    ).toEqual([
      { gtin: 'VARIANT-GTIN', mpn: undefined },
      { gtin: undefined, mpn: undefined },
    ]);
  });
});

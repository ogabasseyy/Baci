import { describe, expect, it } from 'vitest';
import { normalizeProductModelTokens } from './normalize-product-model-tokens';

describe('normalizeProductModelTokens', () => {
  it('strips Bluetooth connectivity suffixes', () => {
    expect(
      normalizeProductModelTokens(['samsung', 'watch', '7', '40mm', 'bt'])
    ).toEqual(['samsung', 'watch', '7', '40mm']);
  });

  it('removes portable descriptors before connectivity suffixes', () => {
    expect(
      normalizeProductModelTokens([
        'jbl',
        'flip',
        '6',
        'portable',
        'bluetooth',
        'speaker',
      ])
    ).toEqual(['jbl', 'flip', '6']);
  });
  it('returns an empty list for empty input', () => {
    expect(normalizeProductModelTokens([])).toEqual([]);
  });

  it('removes merchandising suffixes', () => {
    const tokens = normalizeProductModelTokens([
      'iphone',
      '13',
      'pro',
      '128gb',
      'premium',
      'used',
    ]);

    expect(tokens).toEqual(['iphone', '13', 'pro', '128gb']);
  });

  it('removes region suffixes', () => {
    const tokens = normalizeProductModelTokens(['iphone', 'x', '64gb', 'uk']);

    expect(tokens).toEqual(['iphone', 'x', '64gb']);
  });

  it('removes dual-sim connectivity wording', () => {
    const tokens = normalizeProductModelTokens([
      'tecno',
      'spark',
      'pro',
      'dual',
      'sim',
    ]);

    expect(tokens).toEqual(['tecno', 'spark', 'pro']);
  });

  it('removes consecutive connectivity markers before sim', () => {
    const tokens = normalizeProductModelTokens([
      'samsung',
      's22',
      'ultra',
      'dual',
      'physical',
      'sim',
    ]);

    expect(tokens).toEqual(['samsung', 's22', 'ultra']);
  });

  it('removes a decimal display size and its suffix markers', () => {
    const tokens = normalizeProductModelTokens([
      'dell',
      'xps',
      '15',
      '9560',
      '15',
      '6',
      '4k',
      'touchscreen',
    ]);

    expect(tokens).toEqual(['dell', 'xps', '15', '9560']);
  });

  it('removes a decimal FHD display size from laptop model tokens', () => {
    const tokens = normalizeProductModelTokens([
      'dell',
      'precision',
      '5540',
      '15',
      '6',
      'fhd',
      'non',
      'touch',
    ]);

    expect(tokens).toEqual(['dell', 'precision', '5540']);
  });

  it('removes a phone-sized decimal display suffix', () => {
    const tokens = normalizeProductModelTokens([
      'apple',
      'iphone',
      '15',
      '6',
      '1',
      'inch',
    ]);

    expect(tokens).toEqual(['apple', 'iphone', '15']);
  });

  it('retains model tokens that follow a decimal display size', () => {
    expect(
      normalizeProductModelTokens([
        'macbook',
        'air',
        '13',
        '6',
        'inch',
        'm4',
        '16gb',
        '256gb',
      ])
    ).toEqual(['macbook', 'air', 'm4', '16gb', '256gb']);
  });

  it('removes a terminal quote-only decimal display size', () => {
    const tokens = normalizeProductModelTokens(
      ['msi', 'modern', '15', 'b13m', 'laptop', '15', '6'],
      false,
      true
    );

    expect(tokens).toEqual(['msi', 'modern', '15', 'b13m', 'laptop']);
  });

  it('removes the physical marker with an esim suffix', () => {
    const tokens = normalizeProductModelTokens([
      'iphone',
      '16',
      'pro',
      'physical',
      'esim',
      'new',
    ]);

    expect(tokens).toEqual(['iphone', '16', 'pro']);
  });

  it('removes a hyphenated e-sim suffix', () => {
    const tokens = normalizeProductModelTokens([
      'iphone',
      '14',
      'pro',
      'e',
      'sim',
    ]);

    expect(tokens).toEqual(['iphone', '14', 'pro']);
  });

  it('removes non-SIM connectivity suffixes', () => {
    const lteTokens = normalizeProductModelTokens([
      'apple',
      'series',
      '9',
      '45mm',
      'lte',
    ]);
    const wifiTokens = normalizeProductModelTokens([
      'iphone',
      '14',
      'wi',
      'fi',
      'only',
    ]);
    const cellularTokens = normalizeProductModelTokens([
      'ipad',
      'pro',
      '13',
      'cellular',
    ]);

    expect(lteTokens).toEqual(['apple', 'series', '9', '45mm']);
    expect(wifiTokens).toEqual(['iphone', '14']);
    expect(cellularTokens).toEqual(['ipad', 'pro', '13']);
  });

  it('strips leading connectivity metadata while preserving the model', () => {
    expect(normalizeProductModelTokens(['lte', 'router', 'x5'])).toEqual([
      'router',
      'x5',
    ]);
  });

  it('removes an optional Touch Bar feature suffix', () => {
    const tokens = normalizeProductModelTokens([
      'macbook',
      'pro',
      '2022',
      'm2',
      'touch',
      'bar',
    ]);

    expect(tokens).toEqual(['macbook', 'pro', '2022', 'm2']);
  });

  it('removes the compact Touch Bar spelling', () => {
    const tokens = normalizeProductModelTokens([
      'macbook',
      'pro',
      '2016',
      'i7',
      'touchbar',
    ]);

    expect(tokens).toEqual(['macbook', 'pro', '2016', 'i7']);
  });

  it('removes the all-in-one printer form factor', () => {
    const tokens = normalizeProductModelTokens([
      'hp',
      'smart',
      'tank',
      '750',
      'all',
      'in',
      'one',
      'printer',
    ]);

    expect(tokens).toEqual(['hp', 'smart', 'tank', '750']);
  });

  it('preserves a leading all-in-one desktop model phrase', () => {
    const tokens = normalizeProductModelTokens([
      'hp',
      'all',
      'in',
      'one',
      '24',
    ]);

    expect(tokens).toEqual(['hp', 'all', 'in', 'one', '24']);
  });

  it('removes NFID condition metadata', () => {
    const tokens = normalizeProductModelTokens([
      'iphone',
      'x',
      '3gb',
      '64gb',
      'nfid',
    ]);

    expect(tokens).toEqual(['iphone', 'x', '3gb', '64gb']);
  });

  it('normalizes ordinal generation with a terminal Type-C connector', () => {
    const tokens = normalizeProductModelTokens([
      'apple',
      'airpods',
      'pro',
      '2nd',
      'gen',
      'type',
      'c',
    ]);

    expect(tokens).toEqual(['apple', 'airpods', 'pro', '2']);
  });

  it('keeps a color that is followed by title tokens', () => {
    const tokens = normalizeProductModelTokens([
      'call',
      'of',
      'duty',
      'black',
      'ops4',
    ]);

    expect(tokens).toEqual(['call', 'of', 'duty', 'black', 'ops4']);
  });

  it('strips a color followed only by catalog metadata', () => {
    const tokens = normalizeProductModelTokens([
      'iphone',
      '13',
      'blue',
      '128gb',
    ]);

    expect(tokens).toEqual(['iphone', '13']);
  });
});

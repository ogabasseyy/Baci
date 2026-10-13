import { describe, expect, it } from 'vitest';
import { getProductModelIdentifiers } from './get-product-model-identifiers';

describe('getProductModelIdentifiers game titles', () => {
  it('retains annual game years after an alphanumeric platform token', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'playstation-4',
      productSlugs: ['ps4-f1-2018', 'ps4-f1-2024'],
    });

    expect(identifiers).toEqual(['f1 2018', 'f1 2024']);
  });

  it('preserves sequel numbers after a PlayStation platform generation', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'playstation-4',
      productSlugs: ['ps4-resident-evil-4-remake'],
    });

    expect(identifiers).toEqual(['resident evil 4 remake']);
  });

  it('keeps generic game words that are not a brand alias', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'nintendo-switch',
      productSlugs: ['nintendo-switch-hasbro-game-night'],
    });

    expect(identifiers).toEqual(['hasbro game night']);
  });

  it('preserves region words inside game titles', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'playstation-4',
      productSlugs: ['ps4-last-of-us-2'],
    });

    expect(identifiers).toEqual(['last of us 2']);
  });

  it('preserves an in-token inside a Nintendo Switch title', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'nintendo-switch',
      productSlugs: ['nintendo-switch-hat-in-time'],
    });

    expect(identifiers).toEqual(['hat in time']);
  });

  it('preserves a game title that contains new', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'playstation-4',
      productSlugs: ['ps4-farcry-new-dawn'],
    });

    expect(identifiers).toEqual(['farcry new dawn']);
  });

  it('preserves single-letter game-title tokens', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'nintendo-switch',
      productSlugs: ['nintendo-switch-new-super-mario-bros-u-deluxe'],
    });

    expect(identifiers).toEqual(['new super mario bros u deluxe']);
  });

  it('expands compact alphanumeric game codes for guide matching', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'playstation-4',
      productSlugs: ['ps4-fc24', 'ps4-fc25'],
    });

    expect(identifiers).toEqual(['fc 24', 'fc 25']);
  });

  it('retains consecutive numeric game-title endings', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'nintendo-switch',
      productSlugs: ['nintendo-switch-1-2-switch'],
    });

    expect(identifiers).toEqual(['1 2']);
  });

  it('normalizes joined Donkey Kong catalog titles', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'nintendo-switch',
      productSlugs: ['nintendo-switch-donkeykong-country-returns-hd'],
    });

    expect(identifiers).toEqual(['donkey kong country returns hd']);
  });

  it('preserves the Switch 2 family for console catalog entries', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'nintendo-switch-2',
      productNames: ['Nintendo Switch 2 Console'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['switch 2 console']);
  });

  it('preserves VR in PlayStation VR hardware identifiers', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'vr-headsets',
      brands: ['Sony'],
      productSlugs: ['playstation-vr-2'],
    });

    expect(identifiers).toEqual(['playstation vr 2']);
  });

  it('strips console descriptors from PlayStation hardware identifiers', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'playstation-4',
      productSlugs: ['ps4-console-slim'],
    });

    expect(identifiers).toEqual(['console slim']);
  });

  it('strips console descriptors from Nintendo Switch hardware identifiers', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'nintendo-switch',
      productSlugs: ['nintendo-switch-console-lite'],
    });

    expect(identifiers).toEqual(['console lite']);
  });

  it('retains the console class for fixed-platform console products', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'playstation-5',
      productNames: ['Sony PlayStation 5 Pro Console'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['pro console']);
  });
});

import { describe, expect, it } from 'vitest';
import { selectProductModelIdentifier } from './select-product-model-identifier';

describe('selectProductModelIdentifier', () => {
  it('retains the product line before an alphanumeric model', () => {
    const identifier = selectProductModelIdentifier(['spectre', 'x360']);

    expect(identifier).toBe('spectre x360');
  });

  it('retains all numeric tokens for convertible models', () => {
    const identifier = selectProductModelIdentifier([
      'dell',
      '14',
      'plus',
      '2',
      'in',
      '1',
    ]);

    expect(identifier).toBe('dell 14 plus 2 in 1');
  });

  it('preserves a model family phrase for single-letter series models', () => {
    const identifier = selectProductModelIdentifier(['series', 's']);

    expect(identifier).toBe('series s');
  });

  it('expands compact game codes when preserving game titles', () => {
    const identifier = selectProductModelIdentifier(['fc24'], true);

    expect(identifier).toBe('fc 24');
  });

  it('expands mixed alphanumeric game codes when preserving game titles', () => {
    const identifier = selectProductModelIdentifier(['nba2k24'], true);

    expect(identifier).toBe('nba 2k24');
  });

  it('keeps consecutive numeric game-title tokens', () => {
    const identifier = selectProductModelIdentifier(['1', '2'], true);

    expect(identifier).toBe('1 2');
  });

  it('keeps USB connector letters in accessory identifiers', () => {
    expect(selectProductModelIdentifier(['apple', 'usb', 'c', '20w'])).toBe(
      'apple usb c 20w'
    );
  });

  it('drops a catalog year after an alphanumeric chip model', () => {
    expect(selectProductModelIdentifier(['air', 'm4', '2025'])).toBe('air m4');
  });
});

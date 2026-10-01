import { describe, expect, it } from 'vitest';
import { modelTokenMatchers } from './model-token-matchers';

describe('modelTokenMatchers', () => {
  it('recognizes dimensions without treating convertible model numbers as display sizes', () => {
    const { isConvertibleInConnector, isDimensionToken } = modelTokenMatchers;

    expect(isDimensionToken(['15', '15', 'inch'], 1)).toBe(true);
    expect(isDimensionToken(['14', 'in', '1'], 2)).toBe(false);
    expect(isConvertibleInConnector(['14', 'in', '1'], 1)).toBe(true);
  });

  it('returns false for an out-of-range dimension token', () => {
    expect(modelTokenMatchers.isDimensionToken(['model'], 4)).toBe(false);
  });

  it('strips a numeric laptop processor suffix and its small prefix', () => {
    const result = modelTokenMatchers.stripTrailingLaptopProcessorTier(
      ['elitebook', '830', 'g7', '15', '10310u'],
      'laptops'
    );

    expect(result).toEqual(['elitebook', '830', 'g7']);
  });

  it('strips the complete Intel Core Ultra processor suffix', () => {
    const result = modelTokenMatchers.stripTrailingLaptopProcessorTier(
      ['xps', '13', '9340', 'intel', 'core', 'ultra', '7', '32gb'],
      'laptops'
    );

    expect(result).toEqual(['xps', '13', '9340']);
  });

  it('strips a trailing AMD Ryzen processor suffix', () => {
    const result = modelTokenMatchers.stripTrailingLaptopProcessorTier(
      ['pavilion', '15', 'ryzen', '5', '5500u'],
      'laptops'
    );

    expect(result).toEqual(['pavilion', '15']);
  });

  it('strips a numeric Intel Core processor suffix', () => {
    const result = modelTokenMatchers.stripTrailingLaptopProcessorTier(
      ['inspiron', '7440', 'intel', 'core', '7', '150u'],
      'laptops'
    );

    expect(result).toEqual(['inspiron', '7440']);
  });

  it('expands a simple compact game code for shared tokenization', () => {
    expect(modelTokenMatchers.expandMixedGameCodeToken('fifa23')).toEqual([
      'fifa',
      '23',
    ]);
  });
});

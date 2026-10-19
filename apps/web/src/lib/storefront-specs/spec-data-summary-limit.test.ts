import { describe, expect, it } from 'vitest';
import { buildProductSpecData, MAX_SUMMARY_SPECS } from './spec-data';

describe('buildProductSpecData summary limit', () => {
  it('applies MAX_SUMMARY_SPECS after the final summary dedupe', () => {
    const result = buildProductSpecData({
      category: 'Gaming',
      specs: Array.from({ length: MAX_SUMMARY_SPECS + 2 }, (_, index) => ({
        label: `Public fact ${index + 1}`,
        value: `Value ${index + 1}`,
      })),
    });

    expect(result.specs).toHaveLength(MAX_SUMMARY_SPECS);
    expect(result.specs.at(-1)).toEqual({
      label: `Public fact ${MAX_SUMMARY_SPECS}`,
      value: `Value ${MAX_SUMMARY_SPECS}`,
    });
  });
});

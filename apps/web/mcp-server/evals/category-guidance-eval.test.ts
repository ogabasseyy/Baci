import { describe, expect, it } from 'vitest';
import observedFailure from './camera-category-observed-failure.json';
import { gradeCategoryGuidance } from './category-guidance-eval';

describe('natural request category argument eval', () => {
  it('rejects the actual first camera call captured from ChatGPT', () => {
    const result = gradeCategoryGuidance('camera', observedFailure.traces);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('First emitted arguments must omit category for this natural request');
  });

  it('fails closed without captured arguments and output', () => {
    expect(gradeCategoryGuidance('camera', []).passed).toBe(false);
    expect(gradeCategoryGuidance('camera', [{ result: { type: 'string', value: 'invalid' } }]).passed).toBe(false);
  });

  it('does not substitute a later successful retry for the first empty call', () => {
    const retry = { result: { type: 'string', value: JSON.stringify({
      toolInput: { intent: { alternatives: [{ product_type: 'security_camera', brands: ['Xiaomi'], model: 'C300' }] } },
      toolOutput: { status: 'success', products: [{ name: 'Camera' }] },
    }) } };
    expect(gradeCategoryGuidance('camera', [observedFailure.traces[0], retry]).passed).toBe(false);
    // Synthetic scorer control, not evidence of a successful model evaluation.
    expect(gradeCategoryGuidance('camera', [retry]).passed).toBe(true);
    expect(gradeCategoryGuidance('explicitCategory', [retry]).passed).toBe(false);
    const wrongBrand = { result: { type: 'string', value: retry.result.value.replace('Xiaomi', 'Other') } };
    expect(gradeCategoryGuidance('camera', [wrongBrand]).passed).toBe(false);
  });
});

// Synthetic controls validate the scorer, not live model behavior.
describe('category and model identity controls', () => {
  function trace(model: string, category?: string, brand = 'Xiaomi') {
    return [{ result: { type: 'string', value: JSON.stringify({
      toolInput: { ...(category === undefined ? {} : { category }), intent: { alternatives: [{ product_type: brand === 'Tecno' ? 'phone' : 'security_camera', brands: [brand], model }] } },
      toolOutput: { status: 'success', products: [{ name: model }] },
    }) } }];
  }
  it('accepts category casing allowed by the runtime', () => {
    expect(gradeCategoryGuidance('explicitCategory', trace('C300', 'cameras')).passed).toBe(true);
  });
  it('rejects model suffixes while accepting the stored manufacturer prefix', () => {
    expect(gradeCategoryGuidance('camera', trace('C300 Pro')).passed).toBe(false);
    expect(gradeCategoryGuidance('tecno', trace('Spark 50 5G', undefined, 'Tecno')).passed).toBe(false);
    expect(gradeCategoryGuidance('camera', trace('Xiaomi C300')).passed).toBe(true);
    expect(gradeCategoryGuidance('tecno', trace('Tecno Spark 50', undefined, 'Tecno')).passed).toBe(true);
  });
});

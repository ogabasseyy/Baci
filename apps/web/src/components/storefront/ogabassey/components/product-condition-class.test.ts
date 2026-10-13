import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import { getProductConditionClass } from './product-condition-class';

/**
 * Catalog condition labels arrive as untyped runtime data (CMS/API), so the
 * mapper normalizes defensively. This models a label the static union cannot
 * spell (stray casing/whitespace/separators) reaching the mapper.
 */
function rawCondition(label: string): Product['condition'] {
  return label as Product['condition'];
}

describe('getProductConditionClass', () => {
  it('maps the new label to the new badge class', () => {
    expect(getProductConditionClass('New')).toBe(
      'ogabassey-home-product-card__condition--new'
    );
  });

  it('maps the open-box label to the open-box badge class', () => {
    expect(getProductConditionClass('Open Box')).toBe(
      'ogabassey-home-product-card__condition--open-box'
    );
  });

  it('maps the new-and-used label to the new-used badge class', () => {
    expect(getProductConditionClass('New & Used')).toBe(
      'ogabassey-home-product-card__condition--new-used'
    );
  });

  it('normalizes casing, whitespace, and underscores before matching', () => {
    expect(getProductConditionClass(rawCondition('  NEW  '))).toBe(
      'ogabassey-home-product-card__condition--new'
    );
    expect(getProductConditionClass('open_box')).toBe(
      'ogabassey-home-product-card__condition--open-box'
    );
    expect(getProductConditionClass(rawCondition('Open   Box'))).toBe(
      'ogabassey-home-product-card__condition--open-box'
    );
    expect(getProductConditionClass(rawCondition('new_&_used'))).toBe(
      'ogabassey-home-product-card__condition--new-used'
    );
  });

  it('falls back to the default badge class for other conditions', () => {
    expect(getProductConditionClass('Used')).toBe(
      'ogabassey-home-product-card__condition--default'
    );
    expect(getProductConditionClass('Multiple Conditions')).toBe(
      'ogabassey-home-product-card__condition--default'
    );
    expect(getProductConditionClass('refurbished')).toBe(
      'ogabassey-home-product-card__condition--default'
    );
  });

  it('falls back to the default badge class for missing conditions', () => {
    expect(getProductConditionClass(undefined)).toBe(
      'ogabassey-home-product-card__condition--default'
    );
  });
});

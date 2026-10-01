import { describe, expect, it } from 'vitest';
import {
  featureList,
  headerProps,
  heroProps,
  safeTextProps,
} from './builder-design-capability-prop-definitions';

describe('builder design capability prop definitions', () => {
  it('keeps the bounded Header and Hero editing contract', () => {
    expect(headerProps.navigationLinks).toMatchObject({
      maximumItems: 8,
      type: 'array',
    });
    expect(heroProps.ctaText).toMatchObject({
      default: 'Shop now',
      required: true,
      type: 'string',
    });
  });

  it('keeps shared feature and text descriptors bounded', () => {
    expect(featureList).toMatchObject({
      maximumItems: 8,
      minimumItems: 1,
      type: 'array',
    });
    expect(safeTextProps.content).toMatchObject({
      maximumLength: 2000,
      required: true,
      type: 'string',
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  getBuilderAiPropShape,
  isBuilderAiPropValue,
} from './builder-ai-component-prop-validation';

describe('builder AI property validation facade', () => {
  it('exposes the shape lookup and rejects invalid constrained values', () => {
    expect(getBuilderAiPropShape('Hero', 'ctaLink')).toBe('url');
    expect(getBuilderAiPropShape('Image', 'src')).toBeUndefined();
    expect(isBuilderAiPropValue('ProductGrid', 'limit', 25)).toBe(false);
  });
});

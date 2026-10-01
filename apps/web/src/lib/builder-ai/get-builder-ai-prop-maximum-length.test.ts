import { describe, expect, it } from 'vitest';
import { getBuilderAiPropMaximumLength } from './get-builder-ai-prop-maximum-length';

describe('getBuilderAiPropMaximumLength', () => {
  it('returns the schema limit for copy, labels, and URLs', () => {
    expect(getBuilderAiPropMaximumLength('Text', 'content')).toBe(2000);
    expect(getBuilderAiPropMaximumLength('Hero', 'title')).toBe(120);
    expect(getBuilderAiPropMaximumLength('Hero', 'ctaLink')).toBe(512);
  });

  it('does not assign a string maximum to non-string properties', () => {
    expect(getBuilderAiPropMaximumLength('Hero', 'overlay')).toBeUndefined();
  });
});

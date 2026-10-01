import { describe, expect, it } from 'vitest';
import { getBuilderAiPropShape } from './get-builder-ai-prop-shape';

describe('getBuilderAiPropShape', () => {
  it('returns structured shapes only for editable properties', () => {
    expect(getBuilderAiPropShape('Header', 'navigationLinks')).toBe(
      'link-list'
    );
    expect(getBuilderAiPropShape('Hero', 'image')).toBeUndefined();
  });
});

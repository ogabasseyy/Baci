import { describe, expect, it } from 'vitest';
import { getDuplicateBuilderAiComponentId } from './get-duplicate-builder-ai-component-id';

describe('getDuplicateBuilderAiComponentId', () => {
  it('finds duplicate ids while tolerating legacy components without props', () => {
    expect(
      getDuplicateBuilderAiComponentId([
        { props: { id: 'hero' }, type: 'Hero' },
        { type: 'Legacy' },
        { props: { id: 'hero' }, type: 'Text' },
      ])
    ).toBe('hero');
  });
});

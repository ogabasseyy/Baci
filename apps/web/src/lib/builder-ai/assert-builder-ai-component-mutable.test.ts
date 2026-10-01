import { describe, expect, it } from 'vitest';
import { assertBuilderAiComponentMutable } from './assert-builder-ai-component-mutable';

describe('assertBuilderAiComponentMutable', () => {
  it('rejects protected components while allowing editable components', () => {
    expect(() =>
      assertBuilderAiComponentMutable(
        { props: { id: 'text' }, type: 'Text' },
        Error
      )
    ).not.toThrow();
    expect(() =>
      assertBuilderAiComponentMutable(
        { props: { id: 'header' }, type: 'Header' },
        Error
      )
    ).toThrow('Component is protected or unsupported');
    expect(() =>
      assertBuilderAiComponentMutable(
        { props: { id: 'unsupported' }, type: 'Unsupported' },
        Error
      )
    ).toThrow('Component is protected or unsupported');
  });
});

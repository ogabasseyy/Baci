import type { BuilderData } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { findBuilderAiComponent } from './find-builder-ai-component';

describe('findBuilderAiComponent', () => {
  it('finds a component inside an editable zone collection', () => {
    const content = [{ props: { id: 'zone-text' }, type: 'Text' }];
    const config: BuilderData = {
      content: [{ props: { id: 'page-text' }, type: 'Text' }],
      root: { title: 'Home' },
      zones: { aside: content },
    };

    expect(findBuilderAiComponent(config, 'zone-text')).toEqual({
      content,
      index: 0,
    });
  });

  it('returns undefined for an unknown component id', () => {
    const config: BuilderData = {
      content: [{ props: { id: 'page-text' }, type: 'Text' }],
      root: { title: 'Home' },
    };

    expect(findBuilderAiComponent(config, 'missing')).toBeUndefined();
  });
});

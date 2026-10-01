import type { BuilderData } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { hasDuplicateBuilderAiComponentIds } from './has-duplicate-builder-ai-component-ids';

describe('hasDuplicateBuilderAiComponentIds', () => {
  it('detects an id reused across content and a zone', () => {
    const config: BuilderData = {
      content: [{ props: { id: 'shared-id' }, type: 'Text' }],
      root: { title: 'Home' },
      zones: {
        aside: [{ props: { id: 'shared-id' }, type: 'Text' }],
      },
    };

    expect(hasDuplicateBuilderAiComponentIds(config)).toBe(true);
  });

  it('accepts distinct ids across content collections', () => {
    const config: BuilderData = {
      content: [{ props: { id: 'page-id' }, type: 'Text' }],
      root: { title: 'Home' },
      zones: {
        aside: [{ props: { id: 'zone-id' }, type: 'Text' }],
      },
    };

    expect(hasDuplicateBuilderAiComponentIds(config)).toBe(false);
  });
});

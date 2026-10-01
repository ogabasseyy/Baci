import type { BuilderData } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getBuilderAiContentCollections } from './get-builder-ai-content-collections';

describe('getBuilderAiContentCollections', () => {
  it('includes valid zone component arrays without exposing non-component zone data', () => {
    const config: BuilderData = {
      content: [{ props: { id: 'top-level' }, type: 'Text' }],
      root: { title: 'Home' },
      zones: {
        aside: [{ props: { id: 'zone-text' }, type: 'Text' }],
        legacy: { hidden: true },
      },
    };

    expect(getBuilderAiContentCollections(config)).toEqual([
      [{ props: { id: 'top-level' }, type: 'Text' }],
      [{ props: { id: 'zone-text' }, type: 'Text' }],
    ]);
  });
});

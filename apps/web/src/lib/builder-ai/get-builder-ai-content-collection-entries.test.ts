import type { BuilderData } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getBuilderAiContentCollectionEntries } from './get-builder-ai-content-collection-entries';

describe('getBuilderAiContentCollectionEntries', () => {
  it('keeps root and valid Puck zones addressable by collection name', () => {
    const config: BuilderData = {
      content: [{ props: { id: 'root-text' }, type: 'Text' }],
      root: { title: 'Home' },
      zones: { aside: [{ props: { id: 'zone-text' }, type: 'Text' }] },
    };

    expect(getBuilderAiContentCollectionEntries(config)).toEqual([
      { collection: 'content', content: config.content },
      { collection: 'aside', content: config.zones?.aside },
    ]);
  });
});

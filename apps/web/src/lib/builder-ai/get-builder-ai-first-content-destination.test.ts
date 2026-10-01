import type { BuilderData } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getBuilderAiFirstContentDestination } from './get-builder-ai-first-content-destination';

describe('getBuilderAiFirstContentDestination', () => {
  it('selects a named Puck zone and rejects an unknown collection', () => {
    const aside = [{ props: { id: 'aside-text' }, type: 'Text' }];
    const config: BuilderData = {
      content: [],
      root: { title: 'Home' },
      zones: { aside },
    };

    expect(getBuilderAiFirstContentDestination(config, 'aside', Error)).toBe(
      aside
    );
    expect(() =>
      getBuilderAiFirstContentDestination(config, 'missing', Error)
    ).toThrow('Placement collection was not found');
  });
});

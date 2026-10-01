import type { BuilderData } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { assertBuilderAiUniqueIds } from './assert-builder-ai-unique-ids';

describe('assertBuilderAiUniqueIds', () => {
  it('maps duplicate ids in content or zones to the supplied error', () => {
    const config: BuilderData = {
      content: [{ props: { id: 'duplicate' }, type: 'Text' }],
      root: { title: 'Home' },
      zones: { aside: [{ props: { id: 'duplicate' }, type: 'Text' }] },
    };

    expect(() => assertBuilderAiUniqueIds(config, Error)).toThrow(
      'Duplicate component id'
    );
  });
});

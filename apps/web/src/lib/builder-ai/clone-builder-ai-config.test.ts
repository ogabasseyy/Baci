import type { BuilderData } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { cloneBuilderAiConfig } from './clone-builder-ai-config';

describe('cloneBuilderAiConfig', () => {
  it('returns an independent BuilderData copy', () => {
    const config: BuilderData = {
      content: [{ props: { id: 'text-1', title: 'Original' }, type: 'Text' }],
      root: { title: 'Home' },
    };

    const copy = cloneBuilderAiConfig(config, Error);
    (copy.content[0].props.title as string) = 'Changed';

    expect(config.content[0].props.title).toBe('Original');
  });
});

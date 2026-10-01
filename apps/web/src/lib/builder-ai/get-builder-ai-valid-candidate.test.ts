import type { BuilderData } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getBuilderAiStructuralBaseline } from './builder-ai-structure-guards';
import { getBuilderAiValidCandidate } from './get-builder-ai-valid-candidate';

describe('getBuilderAiValidCandidate', () => {
  it('returns a valid candidate and maps structural failures to the supplied error', () => {
    const config: BuilderData = {
      content: [{ props: { id: 'text-1' }, type: 'Text' }],
      root: { title: 'Home' },
    };
    const baseline = getBuilderAiStructuralBaseline(config);

    expect(getBuilderAiValidCandidate(config, baseline, Error)).toEqual(config);
    expect(() =>
      getBuilderAiValidCandidate(
        {
          ...config,
          content: [{ props: [], type: 'Text' }],
        } as unknown as BuilderData,
        baseline,
        Error
      )
    ).toThrow();
  });
});

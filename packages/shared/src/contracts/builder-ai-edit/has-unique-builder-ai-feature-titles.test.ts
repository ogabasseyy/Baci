import { describe, expect, it } from 'vitest';
import { hasUniqueBuilderAiFeatureTitles } from './has-unique-builder-ai-feature-titles';

describe('hasUniqueBuilderAiFeatureTitles', () => {
  it('rejects duplicate titles', () => {
    expect(
      hasUniqueBuilderAiFeatureTitles([
        { title: 'Delivery' },
        { title: 'Delivery' },
      ])
    ).toBe(false);
  });

  it('accepts distinct titles', () => {
    expect(
      hasUniqueBuilderAiFeatureTitles([
        { title: 'Delivery' },
        { title: 'Support' },
      ])
    ).toBe(true);
  });
});

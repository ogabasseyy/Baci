import { describe, expect, it } from 'vitest';
import { hasUniqueBuilderAiNavigationLabels } from './has-unique-builder-ai-navigation-labels';

describe('hasUniqueBuilderAiNavigationLabels', () => {
  it('rejects repeated labels that would produce duplicate React keys', () => {
    expect(
      hasUniqueBuilderAiNavigationLabels([
        { label: 'Shop', url: '/shop' },
        { label: 'Shop', url: '/sale' },
      ])
    ).toBe(false);
  });

  it('accepts navigation links with distinct labels', () => {
    expect(
      hasUniqueBuilderAiNavigationLabels([
        { label: 'Shop', url: '/shop' },
        { label: 'Sale', url: '/sale' },
      ])
    ).toBe(true);
  });
});

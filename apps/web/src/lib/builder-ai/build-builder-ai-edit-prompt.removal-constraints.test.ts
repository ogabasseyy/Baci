import { describe, expect, it } from 'vitest';
import { buildBuilderAiEditPrompt } from './build-builder-ai-edit-prompt';

function getGuide(
  currentConfig: Parameters<typeof buildBuilderAiEditPrompt>[0]['currentConfig']
) {
  const prompt = buildBuilderAiEditPrompt({
    currentConfig,
    prompt: 'Remove duplicate sections',
  });
  return JSON.parse(
    prompt.match(/<operation-guide>(.+)<\/operation-guide>/)?.[1] ?? ''
  ) as {
    removalConstraints?: {
      protectedComponentIds?: string[];
      requiredComponentGroups?: Array<{
        componentIds: string[];
        componentType: string;
        minimumRetained: number;
      }>;
    };
  };
}

describe('buildBuilderAiEditPrompt removal constraints', () => {
  it('tells providers which sole required components cannot be removed', () => {
    const guide = getGuide({
      content: [
        { props: { headingLevel: 'h1', id: 'hero-h1' }, type: 'Hero' },
        { props: { id: 'products-only' }, type: 'ProductGrid' },
      ],
      root: { title: 'Home' },
    });

    expect(guide.removalConstraints?.protectedComponentIds).toEqual([
      'products-only',
      'hero-h1',
    ]);
  });

  it('tells providers to retain one of each required component group', () => {
    const guide = getGuide({
      content: [
        { props: { id: 'hero-h1-a' }, type: 'Hero' },
        { props: { id: 'hero-h1-b' }, type: 'Hero' },
        { props: { id: 'products-a' }, type: 'ProductGrid' },
        { props: { id: 'products-b' }, type: 'ProductGrid' },
      ],
      root: { title: 'Home' },
    });

    expect(guide.removalConstraints?.requiredComponentGroups).toEqual([
      {
        componentIds: ['products-a', 'products-b'],
        componentType: 'ProductGrid',
        minimumRetained: 1,
      },
      {
        componentIds: ['hero-h1-a', 'hero-h1-b'],
        componentType: 'renderedH1Hero',
        minimumRetained: 1,
      },
    ]);
  });

  it('identifies only rendered H1 Heroes in the required group', () => {
    const guide = getGuide({
      content: [
        { props: { id: 'hero-h1-a' }, type: 'Hero' },
        { props: { headingLevel: 'h2', id: 'hero-h2' }, type: 'Hero' },
        { props: { id: 'hero-h1-b' }, type: 'Hero' },
      ],
      root: { title: 'Home' },
    });

    expect(
      guide.removalConstraints?.requiredComponentGroups?.find(
        (group) => group.componentType === 'renderedH1Hero'
      )?.componentIds
    ).toEqual(['hero-h1-a', 'hero-h1-b']);
  });
});

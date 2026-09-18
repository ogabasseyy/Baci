import { render, screen } from '@testing-library/react-native';
import type { Block } from '@/types/blocks';
import { BlockRenderer } from './BlockRenderer';

jest.mock('@/components/ui/Skeleton', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return {
    HeroSkeleton: () => (
      <MockText testID="hero-skeleton">Loading hero</MockText>
    ),
  };
});

jest.mock('@/hooks', () => ({
  useCategories: () => ({ data: [] }),
}));

jest.mock('@/lib/config', () => ({
  CONFIG: { BUSINESS_TYPE: 'electronics', TEMPLATE_ID: 'default' },
}));

jest.mock('@/lib/templates', () => ({
  getTemplateConfig: () => ({ categoryStyle: 'default', cardVariant: 'grid' }),
}));

jest.mock('./Hero', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return {
    Hero: ({ trailingAdPlacement }: { trailingAdPlacement?: string }) => (
      <MockText
        testID={trailingAdPlacement ? 'hero-carousel-with-ad' : 'hero-carousel'}
      >
        Hero carousel
      </MockText>
    ),
  };
});

jest.mock('./ProductGrid', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('./UtilityPanel', () => ({
  UtilityPanel: () => null,
}));

jest.mock('./JustLaunchedCarousel', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return {
    JustLaunchedCarousel: ({ suppressAds }: { suppressAds?: boolean }) => (
      <MockText
        testID={suppressAds ? 'just-launched-ads-off' : 'just-launched'}
      >
        Just launched
      </MockText>
    ),
  };
});

const emptyHeroBlock: Block = {
  type: 'HeroCarousel',
  props: { id: 'empty-hero', slides: [] },
};

const configuredHeroBlock: Block = {
  type: 'HeroCarousel',
  props: {
    id: 'configured-hero',
    slides: [
      {
        image: 'https://example.com/banner.jpg',
        title: 'Featured phones',
        subtitle: 'Available now',
        ctaText: 'Shop',
        ctaLink: '/category/phones',
      },
    ],
  },
};

function renderBlocks(
  blocks: Block[],
  extraProps: Partial<Parameters<typeof BlockRenderer>[0]> = {}
) {
  return render(
    <BlockRenderer
      blocks={blocks}
      selectedCategoryId={null}
      onCategorySelect={jest.fn()}
      {...extraProps}
    />
  );
}

describe('BlockRenderer', () => {
  it('does not reserve hero placeholder space when resolved content has no slides', () => {
    renderBlocks([emptyHeroBlock]);

    expect(screen.queryByText('Loading hero')).toBeNull();
  });

  it('renders a configured hero carousel when slides are present', () => {
    renderBlocks([configuredHeroBlock]);

    expect(screen.getByText('Hero carousel')).toBeTruthy();
  });

  it('renders the just-launched carousel for a JustLaunched block', () => {
    renderBlocks([{ type: 'JustLaunched', props: { id: 'launches' } }]);

    expect(screen.getByText('Just launched')).toBeTruthy();
  });

  it('withholds ad placements from hero and launch blocks while suppressed', () => {
    // Regression: an obscured feed (e.g. search open) must propagate ad
    // suppression into every block that mounts a placement.
    renderBlocks(
      [
        configuredHeroBlock,
        { type: 'JustLaunched', props: { id: 'launches' } },
      ],
      { suppressAds: true }
    );

    expect(screen.getByTestId('hero-carousel')).toBeTruthy();
    expect(screen.queryByTestId('hero-carousel-with-ad')).toBeNull();
    expect(screen.getByTestId('just-launched-ads-off')).toBeTruthy();
  });

  it('renders no content for an unknown block type', () => {
    const { toJSON } = renderBlocks([
      { type: 'Mystery', props: { id: 'x' } } as unknown as Block,
    ]);

    // The outer container View always renders; an unknown block contributes
    // no children.
    const tree = toJSON() as { children: unknown } | null;
    expect(tree?.children ?? null).toBeNull();
  });
});

import type React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { useCategories } from '@/hooks';
import { CONFIG } from '@/lib/config';
import { getTemplateConfig } from '@/lib/templates';
import type {
  Block,
  HeroCarouselBlock,
  ProductGridBlock,
} from '@/types/blocks';
import { Hero, type HeroSlide } from './Hero';
import { JustLaunchedCarousel } from './JustLaunchedCarousel';
import ProductGrid from './ProductGrid';
import { UtilityPanel } from './UtilityPanel';

interface Category {
  id: string;
  name: string;
  slug: string;
  icon?: string;
}

interface BlockRendererProps {
  blocks: Block[];
  selectedCategoryId: string | null;
  onCategorySelect: (id: string | null) => void;
  blockWrapperStyle?: StyleProp<ViewStyle>;
  renderAfterBlock?: (block: Block, index: number) => React.ReactNode;
  /**
   * While true (e.g. search obscures the feed) the hero and launch ad
   * placements are withheld so no invisible delivery is requested.
   */
  suppressAds?: boolean;
}

export const BlockRenderer: React.FC<BlockRendererProps> = ({
  blocks,
  selectedCategoryId,
  onCategorySelect,
  blockWrapperStyle,
  renderAfterBlock,
  suppressAds = false,
}) => {
  const template = getTemplateConfig(CONFIG.BUSINESS_TYPE, CONFIG.TEMPLATE_ID);
  const { data: categories = [] } = useCategories();

  const selectedCategoryName = (() => {
    if (!selectedCategoryId) return 'Airtime';
    const cat = (categories as Category[]).find(
      (category) => category.id === selectedCategoryId
    );
    if (cat) return cat.name;
    if (selectedCategoryId === 'u-airtime') return 'Airtime';
    if (selectedCategoryId === 'u-data') return 'Data';
    if (selectedCategoryId === 'u-tv') return 'Tv';
    if (selectedCategoryId === 'u-power') return 'Power';
    if (selectedCategoryId === 'u-gaming') return 'Gaming';
    return 'Airtime';
  })();

  return (
    <View>
      {(blocks || []).map((block, index) => {
        const renderedBlock = (() => {
          switch (block.type) {
            case 'HeroCarousel': {
              const heroBlock = block as HeroCarouselBlock;
              const configuredSlides = Array.isArray(heroBlock.props.slides)
                ? heroBlock.props.slides
                : [];

              const slides: HeroSlide[] = configuredSlides.map((slide) => ({
                title: slide.title,
                subtitle: slide.subtitle,
                image: slide.image,
                ctaText: slide.ctaText,
                ctaLink: slide.ctaLink as HeroSlide['ctaLink'],
              }));

              if (slides.length === 0) {
                return null;
              }

              return (
                <Hero
                  slides={slides}
                  autoplayDelay={heroBlock.props.autoplayDelay}
                  trailingAdPlacement={suppressAds ? undefined : 'HOME_STRIP'}
                />
              );
            }
            case 'JustLaunched':
              return <JustLaunchedCarousel suppressAds={suppressAds} />;
            case 'CategoryRail':
              return (
                <UtilityPanel
                  variant={template.categoryStyle}
                  selectedCategoryId={selectedCategoryId}
                  onCategorySelect={onCategorySelect}
                  selectedCategoryName={selectedCategoryName}
                  slug={
                    (block as Block & { props: { slug?: string } }).props.slug
                  }
                />
              );
            case 'ProductGrid':
              return (
                <ProductGrid
                  block={block as ProductGridBlock}
                  selectedCategoryId={selectedCategoryId}
                  variant={template.cardVariant}
                />
              );
            default:
              return null;
          }
        })();

        if (!renderedBlock) {
          return null;
        }

        return (
          <View key={block.props.id} style={blockWrapperStyle}>
            {renderedBlock}
            {renderAfterBlock?.(block, index)}
          </View>
        );
      })}
    </View>
  );
};

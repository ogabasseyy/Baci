/** Multi-tenant hero carousel with parallax, carousel, and standard variants. */
import type { Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useWindowDimensions, View, type ViewToken } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import {
  getMobileAdUnitId,
  type MobileAdBannerPlacementKey,
} from '@/config/mobile-ad-placements';
import { useMobileAdsReadiness } from '@/hooks/use-mobile-ads-readiness';
import { useTheme } from '@/hooks/useTheme';
import { CONFIG } from '@/lib/config';
import { getTemplateConfig } from '@/lib/templates';
import { EliteSlide } from './EliteSlide';
import { FashionSlide } from './FashionSlide';
import { ELITE_HEIGHT, getHeroStyles } from './Hero.styles';
import { HeroAdSlide } from './HeroAdSlide';
import { CAROUSEL_HEIGHT, STANDARD_HEIGHT } from './hero-slide-dimensions';
import { StandardSlide } from './StandardSlide';

export interface HeroSlide {
  title: string;
  subtitle: string;
  image: string;
  ctaText: string;
  ctaLink: Href;
}

interface HeroProps {
  slides?: HeroSlide[];
  autoplayDelay?: number;
  /**
   * Inserts one sponsored slide second (after the first CMS slide). The
   * existing autoplay rotates onto it like any other slide. Ignored while
   * ads are disabled.
   */
  trailingAdPlacement?: MobileAdBannerPlacementKey;
}

type HeroAdSlideItem = { kind: 'hero-ad-slide' };

type HeroRenderItem = HeroSlide | HeroAdSlideItem;

function isHeroAdSlide(item: HeroRenderItem): item is HeroAdSlideItem {
  return 'kind' in item && item.kind === 'hero-ad-slide';
}

const DEFAULT_SLIDES: HeroSlide[] = [];

export function Hero({
  slides = DEFAULT_SLIDES,
  autoplayDelay = 5000,
  trailingAdPlacement,
}: HeroProps) {
  const { colors, isDark } = useTheme();
  const styles = getHeroStyles(colors, isDark);
  const { width: screenWidth } = useWindowDimensions();
  const template = getTemplateConfig(CONFIG.BUSINESS_TYPE, CONFIG.TEMPLATE_ID);
  const scrollX = useSharedValue(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<Animated.FlatList<HeroRenderItem>>(null);
  // The list eagerly renders its initial batch, so constructing the native
  // banner on mount would request/refresh while the sponsored slide is
  // offscreen. Mount it only while its item is actually viewable.
  const [isAdVisible, setIsAdVisible] = useState(false);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 });
  const handleViewableItemsChanged = ({
    viewableItems,
  }: {
    viewableItems: ViewToken[];
  }) => {
    setIsAdVisible(
      viewableItems.some(
        (entry) =>
          entry.isViewable && isHeroAdSlide(entry.item as HeroRenderItem)
      )
    );
  };

  // A missing or malformed placement must fail closed: the registry throws
  // for unconfigured production IDs, and that must never take down the home
  // feed during render.
  let adUnitConfig: ReturnType<typeof getMobileAdUnitId> = {
    enabled: false as const,
  };
  if (trailingAdPlacement) {
    try {
      adUnitConfig = getMobileAdUnitId(trailingAdPlacement);
    } catch {
      adUnitConfig = { enabled: false as const };
    }
  }
  // Consent readiness gates the sponsored slide: the native banner must
  // never be constructed before UMP consent is gathered.
  const adsReadiness = useMobileAdsReadiness({
    enabled: adUnitConfig.enabled === true,
  });
  // A failed banner (no fill, network/load error) drops the sponsored slide
  // so autoplay never rotates shoppers onto a full-height blank page. Keyed
  // by placement so a placement change re-arms the slot.
  const [failedPlacement, setFailedPlacement] =
    useState<MobileAdBannerPlacementKey | null>(null);
  const renderSlides: HeroRenderItem[] =
    adUnitConfig.enabled &&
    adUnitConfig.format === 'banner' &&
    adsReadiness.canRequestAds &&
    failedPlacement !== trailingAdPlacement &&
    slides.length > 0
      ? [slides[0], { kind: 'hero-ad-slide' } as const, ...slides.slice(1)]
      : slides;

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.set(event.contentOffset.x);
    },
  });

  const getHeroHeight = () => {
    if (template.heroVariant === 'parallax') return ELITE_HEIGHT;
    if (template.heroVariant === 'carousel') return CAROUSEL_HEIGHT;
    return STANDARD_HEIGHT;
  };

  useEffect(() => {
    if (renderSlides.length <= 1) return;
    const interval = setInterval(() => {
      const nextIndex = (currentIndex + 1) % renderSlides.length;
      flatListRef.current?.scrollToIndex({ index: nextIndex, animated: true });
    }, autoplayDelay);
    return () => clearInterval(interval);
  }, [currentIndex, renderSlides.length, autoplayDelay]);

  // Don't render if no slides available (prevents "New Collection" placeholder flash)
  if (renderSlides.length === 0) return null;

  const renderSlide = ({ item }: { item: HeroRenderItem }) => {
    if (isHeroAdSlide(item)) {
      if (!trailingAdPlacement) return null;
      return (
        <HeroAdSlide
          height={getHeroHeight()}
          isVisible={isAdVisible}
          onAdFailedToLoad={() => setFailedPlacement(trailingAdPlacement)}
          placement={trailingAdPlacement}
          screenWidth={screenWidth}
          unitId={
            adUnitConfig.enabled ? adUnitConfig.unitId : 'unused-ad-unit-id'
          }
        />
      );
    }
    switch (template.heroVariant) {
      case 'parallax':
        return (
          <EliteSlide
            item={item}
            screenWidth={screenWidth}
            colors={colors}
            isDark={isDark}
            styles={styles}
          />
        );
      case 'carousel':
        return (
          <FashionSlide item={item} screenWidth={screenWidth} styles={styles} />
        );
      default:
        return (
          <StandardSlide
            item={item}
            screenWidth={screenWidth}
            styles={styles}
          />
        );
    }
  };

  return (
    <View style={{ height: getHeroHeight() }}>
      <Animated.FlatList
        ref={flatListRef}
        getItemLayout={(_, index) => ({
          length: screenWidth,
          offset: screenWidth * index,
          index,
        })}
        data={renderSlides}
        extraData={isAdVisible}
        onViewableItemsChanged={handleViewableItemsChanged}
        renderItem={renderSlide}
        testID="hero-carousel-list"
        viewabilityConfig={viewabilityConfig.current}
        keyExtractor={(_, index) => index.toString()}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        onMomentumScrollEnd={(e) =>
          setCurrentIndex(
            Math.round(e.nativeEvent.contentOffset.x / screenWidth)
          )
        }
        scrollEventThrottle={16}
        bounces={false}
      />
      {renderSlides.length > 1 && (
        <View style={styles.dotsContainer} testID="hero-dots">
          {renderSlides.map((slide, index) => (
            <View
              key={isHeroAdSlide(slide) ? 'hero-dot-ad' : slide.image}
              style={[styles.dot, currentIndex === index && styles.dotActive]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

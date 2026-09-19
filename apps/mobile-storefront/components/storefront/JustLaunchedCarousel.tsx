import {
  effectiveLaunchPins,
  LAUNCH_CAROUSEL_LIMIT,
  OGABASSEY_LAUNCH_PINS_SINCE,
  OGABASSEY_PINNED_LAUNCH_SLUGS,
  selectLaunchProducts,
} from '@baci/shared/storefront';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewToken,
} from 'react-native';
import { JustLaunchedSkeleton } from '@/components/storefront/JustLaunchedSkeleton';
import { LaunchAdCard } from '@/components/storefront/LaunchAdCard';
import { LaunchProductCard } from '@/components/storefront/LaunchProductCard';
import { nextOffsetAfterAdToggle } from '@/components/storefront/launch-ad-offset';
import {
  getMobileAdUnitId,
  type MobileAdBannerPlacementKey,
} from '@/config/mobile-ad-placements';
import { useMobileAdsReadiness } from '@/hooks/use-mobile-ads-readiness';
import { usePinnedLaunchProducts } from '@/hooks/use-pinned-launch-products';
import { useProducts } from '@/hooks/use-products';
import { useTheme } from '@/hooks/useTheme';
import { PRODUCT_PLACEHOLDER_IMAGE } from '@/lib/product-normalization';
import type { Product } from '@/types/product';

const SECTION_TITLE = 'Just Launched';
// Matches styles.list.gap: one ad slot occupies a card plus one gap.
const LAUNCH_LIST_GAP = 12;

type LaunchAdCardItem = { kind: 'launch-ad-card' };
type LaunchRenderItem = Product | LaunchAdCardItem;

function isLaunchAdCard(item: LaunchRenderItem): item is LaunchAdCardItem {
  return (item as Partial<LaunchAdCardItem>).kind === 'launch-ad-card';
}

export function JustLaunchedCarousel({
  suppressAds = false,
  adPlacement = 'PRODUCT_GRID_MPU',
}: {
  /**
   * While true (e.g. search obscures the feed) the sponsored card is
   * withheld so no invisible delivery is requested or attributed.
   */
  suppressAds?: boolean;
  /**
   * Placement the sponsored card owns. Page composition passes the slot
   * only to the single elected launch block; when undefined no sponsored
   * card renders so repeated blocks cannot own one logical slot twice.
   */
  adPlacement?: MobileAdBannerPlacementKey;
} = {}) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  // Fetch window is wider than the display count so pins/newest are present.
  const {
    products: newest,
    isLoading,
    isError,
  } = useProducts({
    sortBy: 'newest',
    limit: 50,
  });
  const { data: pinned, isLoading: isPinnedLoading } = usePinnedLaunchProducts(
    OGABASSEY_PINNED_LAUNCH_SLUGS
  );

  // Drop rows that cannot render a complete card up front so a slide can never
  // deep-link to /product/undefined or consume a launch slot with an empty image.
  // `product.image` falls back to PRODUCT_PLACEHOLDER_IMAGE when a product has no
  // uploaded images, so a real renderable image must come from the `images` array
  // (or a non-placeholder `image`) — a placeholder-only "No Image" card must not
  // be hoisted into a launch slot.
  const launchCandidates = [...(pinned ?? []), ...newest].filter(
    (product) =>
      Boolean(product.slug) &&
      (Boolean(product.images?.some(Boolean)) ||
        (Boolean(product.image) && product.image !== PRODUCT_PLACEHOLDER_IMAGE))
  );
  const launchPins = effectiveLaunchPins(
    launchCandidates,
    OGABASSEY_PINNED_LAUNCH_SLUGS,
    OGABASSEY_LAUNCH_PINS_SINCE
  );
  const launchProducts = selectLaunchProducts(launchCandidates, {
    pinned: launchPins,
    limit: LAUNCH_CAROUSEL_LIMIT,
  });

  // A missing or malformed placement must fail closed: the registry throws
  // for unconfigured production IDs, and that must never crash the carousel
  // during render.
  let adUnitConfig: ReturnType<typeof getMobileAdUnitId> = {
    enabled: false as const,
  };
  if (adPlacement) {
    try {
      adUnitConfig = getMobileAdUnitId(adPlacement);
    } catch {
      adUnitConfig = { enabled: false as const };
    }
  }
  // Consent readiness gates the sponsored card: the native banner must never
  // be constructed before UMP consent is gathered. All hooks stay above the
  // early returns below so hook order never changes between renders.
  const adsReadiness = useMobileAdsReadiness({
    enabled: adUnitConfig.enabled === true,
  });
  // A failed banner (no fill, network/load error) drops the sponsored card
  // so shoppers never see a blank 168px "Sponsored" slot. Declared with the
  // other hooks, above the early returns.
  const [adLoadFailed, setAdLoadFailed] = useState(false);

  const cardWidth = Math.round(width * 0.82);
  const showAdCard =
    adUnitConfig.enabled &&
    adUnitConfig.format === 'banner' &&
    adsReadiness.canRequestAds &&
    !adLoadFailed &&
    !suppressAds &&
    launchProducts.length > 0;
  const flatListRef = useRef<FlatList<LaunchRenderItem>>(null);
  const scrollOffsetRef = useRef(0);
  const wasAdShownRef = useRef(showAdCard);
  // The list eagerly renders its initial batch, so constructing the native
  // banner on mount would request/refresh while the sponsored card is
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
          entry.isViewable && isLaunchAdCard(entry.item as LaunchRenderItem)
      )
    );
  };
  useEffect(() => {
    // Consent resolving (or a load failure) inserts or removes the card at
    // index 1 under a scrolled list; shift the offset by one slot so the
    // visible product stays put instead of sliding away.
    const target = nextOffsetAfterAdToggle({
      adSlotWidth: cardWidth + LAUNCH_LIST_GAP,
      insertionOffset: cardWidth + LAUNCH_LIST_GAP,
      isAdShown: showAdCard,
      scrollOffset: scrollOffsetRef.current,
      wasAdShown: wasAdShownRef.current,
    });
    wasAdShownRef.current = showAdCard;
    if (target !== null) {
      flatListRef.current?.scrollToOffset({ offset: target, animated: false });
    }
  }, [showAdCard, cardWidth]);

  if (isError) {
    return null;
  }

  // Show a skeleton on first load (rather than a blank gap) for clearer loading
  // feedback; gate on BOTH queries so pinned items can't pop in after the
  // recent feed resolves first. Error and empty states still render nothing.
  if (isLoading || isPinnedLoading) {
    return (
      <JustLaunchedSkeleton
        cardWidth={cardWidth}
        colors={colors}
        title={SECTION_TITLE}
      />
    );
  }

  if (launchProducts.length === 0) {
    return null;
  }

  const renderItems: LaunchRenderItem[] = showAdCard
    ? [
        launchProducts[0],
        { kind: 'launch-ad-card' },
        ...launchProducts.slice(1),
      ]
    : launchProducts;

  const renderItem = ({ item }: { item: LaunchRenderItem }) => {
    if (isLaunchAdCard(item)) {
      return (
        <LaunchAdCard
          cardWidth={cardWidth}
          colors={colors}
          isVisible={isAdVisible}
          onAdFailedToLoad={() => setAdLoadFailed(true)}
          placement={adPlacement ?? 'PRODUCT_GRID_MPU'}
          unitId={
            adUnitConfig.enabled ? adUnitConfig.unitId : 'unused-ad-unit-id'
          }
        />
      );
    }
    return (
      <LaunchProductCard
        cardWidth={cardWidth}
        colors={colors}
        item={item}
        sectionTitle={SECTION_TITLE}
      />
    );
  };

  return (
    <View style={styles.container}>
      <Text
        accessibilityRole="header"
        style={[styles.heading, { color: colors.text }]}
      >
        {SECTION_TITLE}
      </Text>
      <FlatList
        ref={flatListRef}
        contentContainerStyle={styles.list}
        data={renderItems}
        extraData={isAdVisible}
        horizontal
        keyExtractor={(item) =>
          'kind' in item && item.kind === 'launch-ad-card'
            ? 'launch-ad-card'
            : (item as Product).id
        }
        onViewableItemsChanged={handleViewableItemsChanged}
        renderItem={renderItem}
        showsHorizontalScrollIndicator={false}
        testID="launch-carousel-list"
        viewabilityConfig={viewabilityConfig.current}
        onScroll={(event) => {
          scrollOffsetRef.current = event.nativeEvent.contentOffset.x;
        }}
        scrollEventThrottle={16}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 12,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  list: {
    paddingHorizontal: 16,
    gap: LAUNCH_LIST_GAP,
  },
});

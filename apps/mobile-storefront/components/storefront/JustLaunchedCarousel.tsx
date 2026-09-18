import {
  effectiveLaunchPins,
  LAUNCH_CAROUSEL_LIMIT,
  OGABASSEY_LAUNCH_PINS_SINCE,
  OGABASSEY_PINNED_LAUNCH_SLUGS,
  selectLaunchProducts,
} from '@baci/shared/storefront';
import { useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { LaunchAdCard } from '@/components/storefront/LaunchAdCard';
import { LaunchProductCard } from '@/components/storefront/LaunchProductCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { getMobileAdUnitId } from '@/config/mobile-ad-placements';
import { useMobileAdsReadiness } from '@/hooks/use-mobile-ads-readiness';
import { usePinnedLaunchProducts } from '@/hooks/use-pinned-launch-products';
import { useProducts } from '@/hooks/use-products';
import { useTheme } from '@/hooks/useTheme';
import { PRODUCT_PLACEHOLDER_IMAGE } from '@/lib/product-normalization';
import type { Product } from '@/types/product';

const SECTION_TITLE = 'Just Launched';

export function JustLaunchedCarousel() {
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
  try {
    adUnitConfig = getMobileAdUnitId('PRODUCT_GRID_MPU');
  } catch {
    adUnitConfig = { enabled: false as const };
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

  if (isError) {
    return null;
  }

  const cardWidth = Math.round(width * 0.82);

  // Show a skeleton on first load (rather than a blank gap) for clearer loading
  // feedback; gate on BOTH queries so pinned items can't pop in after the
  // recent feed resolves first. Error and empty states still render nothing.
  if (isLoading || isPinnedLoading) {
    return (
      <View style={styles.container}>
        <Text
          accessibilityRole="header"
          style={[styles.heading, { color: colors.text }]}
        >
          {SECTION_TITLE}
        </Text>
        <View style={styles.list}>
          {[0, 1].map((key) => (
            <View
              key={key}
              style={[
                styles.card,
                {
                  width: cardWidth,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <View
                style={[
                  styles.imageWrap,
                  { backgroundColor: colors.background },
                ]}
              >
                <Skeleton width="100%" height={140} borderRadius={8} />
              </View>
              <View style={styles.info}>
                <Skeleton width="40%" height={10} />
                <Skeleton style={styles.skeletonGap} width="85%" height={16} />
                <Skeleton style={styles.skeletonGap} width="55%" height={14} />
                <Skeleton style={styles.skeletonGap} width="35%" height={13} />
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (launchProducts.length === 0) {
    return null;
  }

  const showAdCard =
    adUnitConfig.enabled &&
    adUnitConfig.format === 'banner' &&
    adsReadiness.canRequestAds &&
    !adLoadFailed &&
    launchProducts.length > 0;
  type LaunchAdCardItem = { kind: 'launch-ad-card' };
  type LaunchRenderItem = Product | LaunchAdCardItem;
  const renderItems: LaunchRenderItem[] = showAdCard
    ? [
        launchProducts[0],
        { kind: 'launch-ad-card' },
        ...launchProducts.slice(1),
      ]
    : launchProducts;

  const isLaunchAdCard = (item: LaunchRenderItem): item is LaunchAdCardItem =>
    (item as Partial<LaunchAdCardItem>).kind === 'launch-ad-card';

  const renderItem = ({ item }: { item: LaunchRenderItem }) => {
    if (isLaunchAdCard(item)) {
      return (
        <LaunchAdCard
          cardWidth={cardWidth}
          colors={colors}
          onAdFailedToLoad={() => setAdLoadFailed(true)}
          placement="PRODUCT_GRID_MPU"
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
        contentContainerStyle={styles.list}
        data={renderItems}
        horizontal
        keyExtractor={(item) =>
          'kind' in item && item.kind === 'launch-ad-card'
            ? 'launch-ad-card'
            : (item as Product).id
        }
        renderItem={renderItem}
        showsHorizontalScrollIndicator={false}
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
    gap: 12,
  },
  card: {
    height: 168,
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },

  imageWrap: {
    width: '42%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  info: {
    flex: 1,
    padding: 14,
    justifyContent: 'center',
    gap: 2,
  },
  skeletonGap: {
    marginTop: 6,
  },
});

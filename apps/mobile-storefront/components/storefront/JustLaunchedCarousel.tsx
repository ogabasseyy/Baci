import {
  effectiveLaunchPins,
  LAUNCH_CAROUSEL_LIMIT,
  launchCtaLabel,
  OGABASSEY_LAUNCH_PINS_SINCE,
  OGABASSEY_PINNED_LAUNCH_SLUGS,
  selectLaunchProducts,
} from '@baci/shared/storefront';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Skeleton } from '@/components/ui/Skeleton';
import { getMobileAdUnitId } from '@/config/mobile-ad-placements';
import { usePinnedLaunchProducts } from '@/hooks/use-pinned-launch-products';
import { useProducts } from '@/hooks/use-products';
import { useTheme } from '@/hooks/useTheme';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { PRODUCT_PLACEHOLDER_IMAGE } from '@/lib/product-normalization';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import type { Product } from '@/types/product';

const SECTION_TITLE = 'Just Launched';
const CARD_HEIGHT = 168;
const IMAGE_PADDING = 8;
const BLURHASH = 'L6PZfSi_.AyE_3t7t7RjE1%MWBR*';

type LaunchAdCardColors = {
  border: string;
  card: string;
  textSecondary: string;
};

function LaunchAdCard({
  cardWidth,
  colors,
  unitId,
}: {
  cardWidth: number;
  colors: LaunchAdCardColors;
  unitId: string;
}) {
  const { BannerAd, BannerAdSize } =
    require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');

  return (
    <View
      accessibilityLabel="Sponsored advertisement"
      style={[
        styles.card,
        styles.adCard,
        {
          width: cardWidth,
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
      ]}
      testID="launch-ad-card"
    >
      <Text style={[styles.adLabel, { color: colors.textSecondary }]}>
        Sponsored
      </Text>
      <BannerAd size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER} unitId={unitId} />
    </View>
  );
}

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

  if (isError) {
    return null;
  }

  const cardWidth = Math.round(width * 0.82);
  const imageSourceWidth = cardWidth * 0.42 - IMAGE_PADDING * 2;
  const imageSourceHeight = CARD_HEIGHT - IMAGE_PADDING * 2;

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

  const adUnitConfig = getMobileAdUnitId('PRODUCT_GRID_MPU');
  const showAdCard =
    adUnitConfig.enabled &&
    adUnitConfig.format === 'banner' &&
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
          unitId={
            adUnitConfig.enabled ? adUnitConfig.unitId : 'unused-ad-unit-id'
          }
        />
      );
    }
    const imageUri = item.image || item.images?.[0];
    const ctaLabel = launchCtaLabel(item.name);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.name} — ${ctaLabel}`}
        onPress={() => {
          if (item.slug) {
            router.push(`/product/${item.slug}`);
          }
        }}
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
          style={[styles.imageWrap, { backgroundColor: colors.background }]}
        >
          {imageUri ? (
            <Image
              accessibilityLabel={item.name}
              cachePolicy="memory-disk"
              contentFit="contain"
              enforceEarlyResizing
              autoplay={false}
              placeholder={{ blurhash: BLURHASH }}
              source={createSafeBoundedImageSource({
                height: imageSourceHeight,
                uri: imageUri,
                width: imageSourceWidth,
              })}
              style={styles.image}
              transition={200}
            />
          ) : null}
        </View>
        <View style={styles.info}>
          <Text style={[styles.badge, { color: colors.primary }]}>
            {SECTION_TITLE}
          </Text>
          <Text numberOfLines={2} style={[styles.name, { color: colors.text }]}>
            {item.name}
          </Text>
          <Text style={[styles.price, { color: colors.text }]}>
            {formatNgnCurrency(item.price)}
          </Text>
          <View style={[styles.ctaButton, { backgroundColor: colors.primary }]}>
            <Text
              style={[
                styles.ctaButtonText,
                { color: colors.primaryForeground },
              ]}
            >
              {ctaLabel}
            </Text>
          </View>
        </View>
      </Pressable>
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
    height: CARD_HEIGHT,
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  adCard: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: IMAGE_PADDING,
  },
  adLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  imageWrap: {
    width: '42%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: IMAGE_PADDING,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  info: {
    flex: 1,
    padding: 14,
    justifyContent: 'center',
    gap: 2,
  },
  badge: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
  },
  price: {
    fontSize: 14,
    fontWeight: '600',
  },
  ctaButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  ctaButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  skeletonGap: {
    marginTop: 6,
  },
});

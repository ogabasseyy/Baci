import { launchCtaLabel } from '@baci/shared/storefront';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import type { Product } from '@/types/product';

const CARD_HEIGHT = 168;
const IMAGE_PADDING = 8;
const BLURHASH = 'L6PZfSi_.AyE_3t7t7RjE1%MWBR*';

interface LaunchProductCardColors {
  background: string;
  border: string;
  card: string;
  primary: string;
  primaryForeground: string;
  text: string;
}

interface LaunchProductCardProps {
  cardWidth: number;
  colors: LaunchProductCardColors;
  item: Product;
  sectionTitle: string;
}

/**
 * Product card for the Just Launched carousel. Extracted from
 * JustLaunchedCarousel so the carousel module stays within the 300-line
 * module-size gate.
 */
export function LaunchProductCard({
  cardWidth,
  colors,
  item,
  sectionTitle,
}: LaunchProductCardProps) {
  const imageSourceWidth = cardWidth * 0.42 - IMAGE_PADDING * 2;
  const imageSourceHeight = CARD_HEIGHT - IMAGE_PADDING * 2;
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
      <View style={[styles.imageWrap, { backgroundColor: colors.background }]}>
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
          {sectionTitle}
        </Text>
        <Text numberOfLines={2} style={[styles.name, { color: colors.text }]}>
          {item.name}
        </Text>
        <Text style={[styles.price, { color: colors.text }]}>
          {formatNgnCurrency(item.price)}
        </Text>
        <View style={[styles.ctaButton, { backgroundColor: colors.primary }]}>
          <Text
            style={[styles.ctaButtonText, { color: colors.primaryForeground }]}
          >
            {ctaLabel}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    height: CARD_HEIGHT,
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
});

/** CMS slide variants for the hero carousel (parallax, carousel, standard). */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, RADIUS, SPACING, withAlpha } from '@/constants/Colors';
import type { useTheme } from '@/hooks/useTheme';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import type { HeroSlide } from './Hero';
import { ELITE_HEIGHT, type getHeroStyles } from './Hero.styles';

type ThemeColors = ReturnType<typeof useTheme>['colors'];
type HeroVariantStyles = ReturnType<typeof getHeroStyles>;

export const CAROUSEL_HEIGHT = 450;
export const STANDARD_HEIGHT = 220;

// Default Blurhash for hero images (neutral gradient)
const DEFAULT_HERO_BLURHASH = 'L6PZfSi_.AyE_3t7t7RjE1%MWBR*';

// 2026 Best Practice: Common image props for offline caching
const heroImageProps = {
  placeholder: { blurhash: DEFAULT_HERO_BLURHASH },
  transition: 300,
  cachePolicy: 'memory-disk' as const, // Persist images for offline viewing
  autoplay: false,
};

function getHeroImageSource(uri: string, width: number, height: number) {
  return createSafeBoundedImageSource({ height, uri, width });
}

const getCoverHeroImageSource = (uri: string, width: number, height: number) =>
  createSafeBoundedImageSource({ fit: 'cover', height, uri, width });

export const EliteSlide = ({
  item,
  screenWidth,
  colors,
  isDark,
  styles,
}: {
  item: HeroSlide;
  screenWidth: number;
  colors: ThemeColors;
  isDark: boolean;
  styles: HeroVariantStyles;
}) => {
  const imageSource = getHeroImageSource(
    item.image,
    screenWidth * 0.5,
    ELITE_HEIGHT
  );

  return (
    <View style={[styles.eliteSlideContainer, { width: screenWidth }]}>
      <View style={styles.eliteCard}>
        {/* Background Image/Gradient - mocked as light gradient for now */}
        <LinearGradient
          colors={
            isDark
              ? [colors.card, colors.background]
              : [colors.muted, colors.border]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.eliteCardContent}>
          <View style={styles.eliteTextColumn}>
            <Text style={styles.eliteTitle} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={styles.eliteSubtitle} numberOfLines={3}>
              {item.subtitle}
            </Text>
            <Pressable
              style={styles.eliteCta}
              onPress={() => router.push(item.ctaLink)}
              accessibilityLabel={item.ctaText}
              accessibilityRole="button"
            >
              <Text style={styles.eliteCtaText}>{item.ctaText}</Text>
            </Pressable>
          </View>

          <View style={styles.eliteImageColumn}>
            <Image
              source={imageSource}
              style={styles.eliteProductImage}
              contentFit="contain"
              {...heroImageProps}
            />
          </View>
        </View>
      </View>
    </View>
  );
};

export const FashionSlide = ({
  item,
  screenWidth,
  styles,
}: {
  item: HeroSlide;
  screenWidth: number;
  styles: HeroVariantStyles;
}) => (
  <View style={[styles.slide, { width: screenWidth, height: CAROUSEL_HEIGHT }]}>
    <Image
      source={getCoverHeroImageSource(item.image, screenWidth, CAROUSEL_HEIGHT)}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      {...heroImageProps}
    />
    <LinearGradient
      colors={['transparent', withAlpha(palette.black, 0.8)]}
      style={styles.gradient}
    />
    <View style={styles.fashionContent}>
      <Text style={styles.fashionTitle}>{item.title}</Text>
      <Pressable
        style={styles.fashionCta}
        onPress={() => router.push(item.ctaLink)}
        accessibilityLabel={item.ctaText}
        accessibilityRole="link"
      >
        <Text style={styles.fashionCtaText}>{item.ctaText} →</Text>
      </Pressable>
    </View>
  </View>
);

export const StandardSlide = ({
  item,
  screenWidth,
  styles,
}: {
  item: HeroSlide;
  screenWidth: number;
  styles: HeroVariantStyles;
}) => (
  <View
    style={[
      styles.slide,
      { width: screenWidth, height: STANDARD_HEIGHT, padding: SPACING.md },
    ]}
  >
    <Image
      source={getCoverHeroImageSource(item.image, screenWidth, STANDARD_HEIGHT)}
      style={[StyleSheet.absoluteFill, { borderRadius: RADIUS.xl }]}
      contentFit="cover"
      {...heroImageProps}
    />
    <LinearGradient
      colors={[withAlpha(palette.black, 0.7), 'transparent']}
      style={[StyleSheet.absoluteFill, { borderRadius: RADIUS.xl }]}
    />
    <View style={styles.standardContent}>
      <Text style={styles.standardTitle}>{item.title}</Text>
      <Pressable
        style={styles.standardCta}
        onPress={() => router.push(item.ctaLink)}
        accessibilityLabel={item.ctaText}
        accessibilityRole="button"
      >
        <Text style={styles.standardCtaText}>{item.ctaText}</Text>
      </Pressable>
    </View>
  </View>
);

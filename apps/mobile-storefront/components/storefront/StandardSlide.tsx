import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, RADIUS, SPACING, withAlpha } from '@/constants/Colors';
import type { HeroSlide } from './Hero';
import {
  getCoverHeroImageSource,
  type HeroVariantStyles,
  heroImageProps,
  STANDARD_HEIGHT,
} from './HeroSlideShared';

interface StandardSlideProps {
  item: HeroSlide;
  screenWidth: number;
  styles: HeroVariantStyles;
}

/** Compact rounded slide with a top gradient and inline CTA. */
export function StandardSlide({
  item,
  screenWidth,
  styles,
}: StandardSlideProps) {
  return (
    <View
      style={[
        styles.slide,
        { width: screenWidth, height: STANDARD_HEIGHT, padding: SPACING.md },
      ]}
    >
      <Image
        source={getCoverHeroImageSource(
          item.image,
          screenWidth,
          STANDARD_HEIGHT
        )}
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
}

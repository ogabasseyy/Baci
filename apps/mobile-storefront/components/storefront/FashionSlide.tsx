import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, withAlpha } from '@/constants/Colors';
import type { HeroSlide } from './Hero';
import {
  CAROUSEL_HEIGHT,
  getCoverHeroImageSource,
  type HeroVariantStyles,
  heroImageProps,
} from './HeroSlideShared';

interface FashionSlideProps {
  item: HeroSlide;
  screenWidth: number;
  styles: HeroVariantStyles;
}

/** Full-bleed fashion slide with a bottom gradient and overlay CTA. */
export function FashionSlide({ item, screenWidth, styles }: FashionSlideProps) {
  return (
    <View
      style={[styles.slide, { width: screenWidth, height: CAROUSEL_HEIGHT }]}
    >
      <Image
        source={getCoverHeroImageSource(
          item.image,
          screenWidth,
          CAROUSEL_HEIGHT
        )}
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
}

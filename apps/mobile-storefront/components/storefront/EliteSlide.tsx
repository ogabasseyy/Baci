import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { HeroSlide } from './Hero';
import { ELITE_HEIGHT } from './Hero.styles';
import type { HeroThemeColors, HeroVariantStyles } from './HeroSlideShared';
import { heroImageProps } from './hero-image-props';
import { getHeroImageSource } from './hero-slide-image';

interface EliteSlideProps {
  colors: HeroThemeColors;
  isDark: boolean;
  item: HeroSlide;
  screenWidth: number;
  styles: HeroVariantStyles;
}

/** Parallax hero slide: text column beside a bounded product image. */
export function EliteSlide({
  colors,
  isDark,
  item,
  screenWidth,
  styles,
}: EliteSlideProps) {
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
}

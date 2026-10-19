import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { BRAND } from '@/constants/Colors';
import { useTheme } from '@/hooks/useTheme';
import styles from '../ProductCard.styles';
import { formatSearchCardPrice } from './search-price';
import type { EditorialProductCardProps } from './types';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function EditorialProductCard({
  product,
  imageSource,
  imageProps,
  showLocalPlaceholder,
  handlePress,
  handleAnimateIn,
  handleAnimateOut,
  animatedStyle,
  textColor,
  screenWidth,
  colors: colorsProp,
}: EditorialProductCardProps) {
  const { colors: themeColors } = useTheme();
  const colors = colorsProp ?? themeColors;

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handleAnimateIn}
      onPressOut={handleAnimateOut}
      style={[
        styles.editorialContainer,
        { width: screenWidth - 32 },
        animatedStyle,
      ]}
      accessibilityLabel={`${product.name}, ${formatSearchCardPrice(product)}`}
      accessibilityRole="button"
    >
      {showLocalPlaceholder ? (
        <View
          style={[
            styles.editorialImage,
            styles.imagePlaceholder,
            { backgroundColor: colors.muted },
          ]}
        >
          <Ionicons
            name="image-outline"
            size={40}
            color={colors.mutedForeground}
          />
        </View>
      ) : (
        <Image
          {...imageProps}
          source={imageSource}
          style={styles.editorialImage}
        />
      )}
      <View style={styles.editorialContent}>
        <Text style={[styles.editorialName, { color: textColor }]}>
          {product.name}
        </Text>
        <Text style={[styles.editorialPrice, { color: BRAND.primary }]}>
          {formatSearchCardPrice(product)}
        </Text>
      </View>
    </AnimatedPressable>
  );
}

import { useEffect } from 'react';
import {
  type DimensionValue,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({
  width = '100%',
  height = 20,
  borderRadius = 4,
  style,
}: SkeletonProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  // Reanimated Shared Value for loading shimmers
  const opacityValue = useSharedValue(0.3);

  useEffect(() => {
    // Pure Reanimated infinite loop driving opacity pulses natively on C++ thread
    // .set()/.get() are the React Compiler-compatible shared value accessors.
    opacityValue.set(
      withRepeat(
        withSequence(
          withTiming(0.7, { duration: 1000 }),
          withTiming(0.3, { duration: 1000 })
        ),
        -1, // Infinitely loop
        false // Handle sequences within repeating structure
      )
    );
    return () => {
      cancelAnimation(opacityValue);
      opacityValue.set(0.3);
    };
  }, [opacityValue]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacityValue.get(),
  }));

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: colors.border,
        },
        style,
        animatedStyle,
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading content"
      accessible
    />
  );
}

/**
 * Product Card Skeleton
 */
export function ProductCardSkeleton() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <View style={[styles.productCard, { backgroundColor: colors.card }]}>
      <Skeleton width="100%" height={160} borderRadius={12} />
      <View style={styles.productContent}>
        <Skeleton width="80%" height={16} style={styles.mb8} />
        <Skeleton width="50%" height={14} style={styles.mb8} />
        <Skeleton width="40%" height={18} />
      </View>
    </View>
  );
}

/**
 * Product Grid Skeleton (2 columns)
 */
export function ProductGridSkeleton({ count = 4 }: { count?: number }) {
  // Static decorative placeholders: positional ids are stable keys
  // because the list never reorders (only its length varies).
  const items = Array.from({ length: count }, (_, position) => position);
  return (
    <View style={styles.grid}>
      {items.map((position) => (
        <View
          key={`grid-skeleton-item-${position}`}
          style={[
            styles.gridItem,
            position % 2 === 0 ? styles.gridLeft : styles.gridRight,
          ]}
        >
          <ProductCardSkeleton />
        </View>
      ))}
    </View>
  );
}

/**
 * Hero Carousel Skeleton
 */
export function HeroSkeleton() {
  return (
    <View style={styles.heroContainer}>
      <Skeleton width="100%" height={180} borderRadius={16} />
      <View style={styles.heroDots}>
        {[0, 1, 2].map((i) => (
          <Skeleton
            key={i}
            width={8}
            height={8}
            borderRadius={4}
            style={styles.dot}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Full Home Screen Skeleton
 */
export function HomeScreenSkeleton() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Search bar skeleton */}
      <View style={styles.searchContainer}>
        <Skeleton width="100%" height={48} borderRadius={12} />
      </View>

      {/* Hero skeleton */}
      <HeroSkeleton />

      {/* Section header skeleton */}
      <View style={styles.sectionHeader}>
        <Skeleton width={150} height={20} />
        <Skeleton width={60} height={16} />
      </View>

      {/* Products grid skeleton */}
      <ProductGridSkeleton count={4} />
    </View>
  );
}

/**
 * Product Detail Skeleton
 */
export function ProductDetailSkeleton() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Image skeleton */}
      <Skeleton width="100%" height={350} borderRadius={0} />

      <View style={styles.detailContent}>
        {/* Title */}
        <Skeleton width="90%" height={24} style={styles.mb8} />
        <Skeleton width="60%" height={20} style={styles.mb16} />

        {/* Price */}
        <Skeleton width={120} height={28} style={styles.mb16} />

        {/* Description */}
        <Skeleton width="100%" height={16} style={styles.mb8} />
        <Skeleton width="100%" height={16} style={styles.mb8} />
        <Skeleton width="70%" height={16} style={styles.mb16} />

        {/* Button */}
        <Skeleton width="100%" height={52} borderRadius={26} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  productCard: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },
  productContent: {
    padding: 12,
  },
  mb8: {
    marginBottom: 8,
  },
  mb16: {
    marginBottom: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
  },
  gridItem: {
    width: '50%',
  },
  gridLeft: {
    paddingRight: 8,
  },
  gridRight: {
    paddingLeft: 8,
  },
  heroContainer: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  heroDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 12,
    gap: 6,
  },
  dot: {
    marginHorizontal: 3,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  detailContent: {
    padding: 16,
  },
});

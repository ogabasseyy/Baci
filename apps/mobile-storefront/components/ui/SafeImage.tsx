import Ionicons from '@react-native-vector-icons/ionicons';
import { Image, type ImageProps } from 'expo-image';
import { useState } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { resolveSafeImageSource } from '@/lib/safe-image-source';

// Default blurhash for smooth loading placeholder
const DEFAULT_BLURHASH = 'L6PZfSi_.AyE_3t7t7RjE1%MWBR*';

export interface SafeImageProps extends Omit<ImageProps, 'onError'> {
  /**
   * Optional callback when image fails to load
   */
  onLoadError?: (error: Error) => void;
  /**
   * Custom fallback component to render on error
   */
  fallbackComponent?: React.ReactNode;
  /**
   * Whether to show a placeholder icon on error (default: true)
   */
  showFallbackIcon?: boolean;
  /**
   * Container style for the fallback view
   */
  fallbackStyle?: StyleProp<ViewStyle>;
  /**
   * Fallback icon size (default: 32)
   */
  fallbackIconSize?: number;
  /**
   * Fallback icon color (defaults to colors.textSecondary)
   */
  fallbackIconColor?: string;
}

export function SafeImage({
  source,
  style,
  placeholder,
  transition = 300,
  cachePolicy = 'memory-disk',
  contentFit = 'cover',
  onLoadError,
  onLoadStart,
  fallbackComponent,
  showFallbackIcon = true,
  fallbackStyle,
  fallbackIconSize = 32,
  fallbackIconColor,
  ...rest
}: SafeImageProps) {
  const [hasError, setHasError] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const actualIconColor = fallbackIconColor ?? colors.textSecondary;
  const [errorCount, setErrorCount] = useState(0);

  // Handle image load errors gracefully. React Compiler keeps this handler
  // in sync with the latest props, so no ref-based stale-closure guard is
  // needed (and writing refs during render blocks compilation).
  const handleError = (error: { error: string }) => {
    // Prevent infinite error loops
    if (errorCount >= 2) return;

    setErrorCount((prev) => prev + 1);
    setHasError(true);

    // Log for debugging in development
    if (__DEV__) {
      console.warn(
        '[SafeImage] Image load failed:',
        error.error,
        '\nSource:',
        source
      );
    }

    // Call optional error callback
    if (onLoadError) {
      onLoadError(new Error(error.error));
    }
  };

  // Reset error state when source changes, then forward to any caller callback.
  const handleLoadStart = () => {
    if (hasError) {
      setHasError(false);
      setErrorCount(0);
    }
    onLoadStart?.();
  };

  // If we have a custom fallback component, use it
  if (hasError && fallbackComponent) {
    return <>{fallbackComponent}</>;
  }

  // If error and showFallbackIcon, render placeholder view
  if (hasError && showFallbackIcon) {
    return (
      <View
        style={[
          styles.fallbackContainer,
          { backgroundColor: colors.muted },
          style,
          fallbackStyle,
        ]}
        accessibilityLabel="Image unavailable"
      >
        <Ionicons
          name="image-outline"
          size={fallbackIconSize}
          color={actualIconColor}
        />
      </View>
    );
  }

  // Determine placeholder - use provided or default blurhash
  const effectivePlaceholder = placeholder || { blurhash: DEFAULT_BLURHASH };
  const safeSource = resolveSafeImageSource(source, {
    fit: contentFit === 'cover' ? 'cover' : 'inside',
  });

  return (
    <Image
      source={safeSource}
      style={style}
      placeholder={effectivePlaceholder}
      transition={transition}
      cachePolicy={cachePolicy}
      contentFit={contentFit}
      {...rest}
      // Remote catalog images are untrusted and may be animated GIF/APNG/WebP.
      // Keep the first frame without starting the native frame decoder loop;
      // this avoids repeated large bitmap allocations on low-memory Android.
      autoplay={false}
      onError={handleError}
      onLoadStart={handleLoadStart}
    />
  );
}

/**
 * Helper hook to create SafeImage props with common settings
 */
export function useSafeImageProps(blurhash?: string) {
  return {
    placeholder: { blurhash: blurhash || DEFAULT_BLURHASH },
    transition: 300,
    cachePolicy: 'memory-disk' as const,
    contentFit: 'cover' as const,
  };
}

const styles = StyleSheet.create({
  fallbackContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default SafeImage;

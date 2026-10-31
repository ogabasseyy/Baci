import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  type ImageErrorEvent,
  type ImageProps,
  type ImageSourcePropType,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import { SvgUri, SvgXml } from 'react-native-svg';
import { useTheme } from '@/hooks/useTheme';
import { resolveSafeImageSource } from './safe-image-source';

const DEFAULT_BLURHASH = 'L6PZfSi_.AyE_3t7t7RjE1%MWBR*';

async function fetchSvgXml(uri: string): Promise<string> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export interface SafeImageProps extends Omit<ImageProps, 'onError'> {
  onLoadError?: (error: Error) => void;
  fallbackSource?: ImageSourcePropType;
  fallbackComponent?: React.ReactNode;
  showFallbackIcon?: boolean;
  fallbackStyle?: StyleProp<ViewStyle>;
  fallbackIconSize?: number;
  fallbackIconColor?: string;
  contentFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  placeholder?: string | { blurhash: string };
  transition?: number;
  cachePolicy?: 'none' | 'disk' | 'memory' | 'memory-disk';
}

function SafeImage({
  source,
  fallbackSource,
  style,
  placeholder: _placeholder,
  transition: _transition,
  cachePolicy: _cachePolicy,
  contentFit = 'cover',
  onLoadError,
  onLoadStart: propsOnLoadStart,
  fallbackComponent,
  showFallbackIcon = true,
  fallbackStyle,
  fallbackIconSize = 32,
  fallbackIconColor,
  ...rest
}: SafeImageProps) {
  const { colors } = useTheme();
  const [hasError, setHasError] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const [isUsingFallbackSource, setIsUsingFallbackSource] = useState(false);
  const [xml, setXml] = useState<string | null>(null);
  const [isLoadingXml, setIsLoadingXml] = useState(false);

  const sourceKey = resolveSafeImageSource(source).key;
  const fallbackSourceKey = resolveSafeImageSource(fallbackSource).key;
  const activeSource = isUsingFallbackSource ? fallbackSource : source;
  const { source: resolvedSource, uri } = resolveSafeImageSource(activeSource);

  // biome-ignore lint/correctness/useExhaustiveDependencies: source value keys intentionally reset transient loading state when image inputs change.
  useEffect(() => {
    setHasError(false);
    setErrorCount(0);
    setIsUsingFallbackSource(false);
    setXml(null);
    setIsLoadingXml(false);
  }, [fallbackSourceKey, sourceKey]);

  // SVG Detection Logic
  const isSvg =
    typeof uri === 'string' &&
    (uri.toLowerCase().includes('.svg') ||
      uri.startsWith('data:image/svg+xml'));

  // Fetch SVG XML for more reliable rendering
  useEffect(() => {
    let isMounted = true;

    const fetchSvg = async () => {
      if (!isSvg || !uri || uri.startsWith('data:')) return;

      setIsLoadingXml(true);
      try {
        const text = await fetchSvgXml(uri);

        if (isMounted) {
          if (!text || text.trim().length === 0) {
            console.warn('[SafeImage] SVG content is empty for uri:', uri);
            setHasError(true);
            setIsLoadingXml(false);
            return;
          }
          setXml(text);
          setIsLoadingXml(false);
        }
      } catch (err) {
        if (isMounted) {
          console.warn('[SafeImage] SVG XML fetch failed:', err);
          setIsLoadingXml(false);
          setHasError(true);
        }
      }
    };

    fetchSvg();
    return () => {
      isMounted = false;
    };
  }, [isSvg, uri]);

  // Handle image load errors gracefully
  const handleError = (e: ImageErrorEvent) => {
    // Prevent infinite error loops
    if (errorCount >= 2) return;

    setErrorCount((prev) => prev + 1);
    if (fallbackSource && !isUsingFallbackSource) {
      setIsUsingFallbackSource(true);
    } else {
      setHasError(true);
    }

    const errorMessage = e?.nativeEvent?.error || 'Unknown image loading error';

    // Log for debugging in development
    if (__DEV__) {
      console.warn(
        '[SafeImage] Image load failed:',
        errorMessage,
        '\nSource:',
        activeSource
      );
    }

    // Call optional error callback
    if (onLoadError) {
      onLoadError(new Error(errorMessage));
    }
  };

  // Reset error state when source changes
  const handleLoadStart = () => {
    if (hasError) {
      setHasError(false);
      setErrorCount(0);
    }
    if (propsOnLoadStart) {
      propsOnLoadStart();
    }
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
          { backgroundColor: colors.card },
          style as StyleProp<ViewStyle>,
          fallbackStyle,
        ]}
      >
        <Ionicons
          name="image-outline"
          size={fallbackIconSize}
          color={fallbackIconColor || colors.textSecondary}
        />
      </View>
    );
  }

  // Render SVG if XML is loaded or if it's a data URI
  if (isSvg && !hasError) {
    if (isLoadingXml) {
      return (
        <View
          style={[
            styles.loadingContainer,
            { backgroundColor: colors.background },
            style,
          ]}
        >
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      );
    }

    const flattenedStyle = StyleSheet.flatten(style);
    const svgWidth =
      typeof flattenedStyle?.width === 'number' ? flattenedStyle.width : 48;
    const svgHeight =
      typeof flattenedStyle?.height === 'number' ? flattenedStyle.height : 48;

    if (uri?.startsWith('data:image/svg+xml')) {
      // Data URI - use SvgXml with direct mapping
      return (
        <View style={[style, styles.svgWrapper]}>
          <SvgUri
            uri={uri}
            width={svgWidth}
            height={svgHeight}
            onError={() => setHasError(true)}
          />
        </View>
      );
    }

    if (xml) {
      return (
        <View style={[style, styles.svgWrapper]}>
          <SvgXml xml={xml} width={svgWidth} height={svgHeight} />
        </View>
      );
    }
  }

  // Map contentFit (expo-image) to resizeMode (react-native)
  let resizeMode: 'cover' | 'contain' | 'stretch' | 'center' = 'cover';
  if (contentFit === 'contain') resizeMode = 'contain';
  if (contentFit === 'fill') resizeMode = 'stretch';
  if (contentFit === 'none') resizeMode = 'center';

  // NOTE: Completely isolated from expo-image due to iOS CoreGraphics crash
  // related to 24-bpp PNGs and color spaces (rdar://143602439)
  return (
    <Image
      source={resolvedSource as ImageSourcePropType}
      style={style}
      resizeMode={resizeMode}
      onError={handleError}
      onLoadStart={handleLoadStart}
      {...rest}
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
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  svgWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default SafeImage;

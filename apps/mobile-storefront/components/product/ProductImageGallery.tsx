import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import { ImageZoomModal } from '@/components/product/ImageZoomModal';
import { BLURHASH_VARIANTS } from '@/components/storefront/ProductCard';
import type Colors from '@/constants/Colors';
import { BRAND, RADIUS } from '@/constants/Colors';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';

type ColorsScheme = (typeof Colors)['light'];

export interface ProductImageGalleryProps {
  images: string[];
  selectedImageIndex: number;
  setSelectedImageIndex: (index: number) => void;
  imageAnimatedStyle: StyleProp<AnimatedStyle<ViewStyle>>;
  showImageZoom: boolean;
  setShowImageZoom: (show: boolean) => void;
  discountPercentage: number | null | undefined;
  colors: ColorsScheme;
  headerHeight: number;
}

export function ProductImageGallery({
  images,
  selectedImageIndex,
  setSelectedImageIndex,
  imageAnimatedStyle,
  showImageZoom,
  setShowImageZoom,
  discountPercentage,
  colors,
  headerHeight,
}: ProductImageGalleryProps) {
  const { width: screenWidth } = useWindowDimensions();

  return (
    <>
      {/* Main Image */}
      <Pressable
        style={[styles.imageContainer, { height: headerHeight }]}
        onPress={() => setShowImageZoom(true)}
        accessibilityLabel="Tap to zoom product image"
        accessibilityRole="button"
        accessibilityHint="Opens full-screen image viewer with zoom"
      >
        <Animated.View style={[styles.parallaxWrapper, imageAnimatedStyle]}>
          <Image
            source={createSafeBoundedImageSource({
              fit: 'cover',
              height: headerHeight,
              uri: images[selectedImageIndex],
              width: screenWidth,
            })}
            style={styles.mainImage}
            contentFit="cover"
            transition={300}
            placeholder={{ blurhash: BLURHASH_VARIANTS.default }}
            cachePolicy="memory-disk"
            autoplay={false}
          />
        </Animated.View>
        <LinearGradient
          colors={['rgba(0,0,0,0.3)', 'transparent', 'transparent']}
          style={StyleSheet.absoluteFill}
        />

        {/* Discount Badge */}
        {discountPercentage ? (
          <View style={styles.discountBadge}>
            <Text style={styles.discountText}>-{discountPercentage}%</Text>
          </View>
        ) : null}

        {/* Zoom Hint Icon */}
        <View style={styles.zoomHint}>
          <Ionicons name="expand-outline" size={20} color="#FFF" />
        </View>
      </Pressable>

      {/* Thumbnail Strip */}
      {images.length > 1 && (
        <View style={styles.thumbnailsWrapper}>
          <Animated.ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.thumbnailsContainer}
          >
            {images.map((img, idx) => (
              <Pressable
                key={`${img}-${idx}`}
                onPress={() => setSelectedImageIndex(idx)}
                style={[
                  styles.thumbnail,
                  {
                    borderColor:
                      selectedImageIndex === idx
                        ? BRAND.primary
                        : colors.border,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`View image ${idx + 1} of ${images.length}`}
                accessibilityState={{ selected: selectedImageIndex === idx }}
                accessibilityHint="Double tap to show this image in the main view"
              >
                <Image
                  source={createSafeBoundedImageSource({
                    fit: 'cover',
                    height: 64,
                    uri: img,
                    width: 64,
                  })}
                  style={styles.thumbnailImage}
                  contentFit="cover"
                  placeholder={{ blurhash: BLURHASH_VARIANTS.default }}
                  transition={200}
                  cachePolicy="memory-disk"
                  autoplay={false}
                />
              </Pressable>
            ))}
          </Animated.ScrollView>
        </View>
      )}

      {/* Image Zoom Modal */}
      <ImageZoomModal
        visible={showImageZoom}
        images={images}
        initialIndex={selectedImageIndex}
        onClose={() => setShowImageZoom(false)}
        onIndexChange={(index) => setSelectedImageIndex(index)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  imageContainer: {
    width: '100%',
    backgroundColor: '#F3F4F6',
    overflow: 'hidden',
  },
  parallaxWrapper: {
    ...StyleSheet.absoluteFill,
  },
  mainImage: {
    width: '100%',
    height: '100%',
  },
  discountBadge: {
    position: 'absolute',
    top: 110,
    left: 16,
    backgroundColor: BRAND.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.md,
  },
  discountText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
  zoomHint: {
    position: 'absolute',
    bottom: 40,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailsWrapper: {
    marginBottom: 24,
  },
  thumbnailsContainer: {
    gap: 12,
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: RADIUS.lg,
    borderWidth: 2,
    overflow: 'hidden',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
});

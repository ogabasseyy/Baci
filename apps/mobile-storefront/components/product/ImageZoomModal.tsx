import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BLURHASH_VARIANTS } from '@/components/storefront/ProductCard';
import { SPACING } from '@/constants/Colors';
import { getOptionalGestureHandlerRuntime } from '@/lib/optional-gesture-handler';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import { useImageZoom } from './hooks/useImageZoom';
import styles from './ImageZoomModal.styles';
import { getImageZoomDecodeBounds } from './image-zoom-bounds';

interface ImageZoomModalProps {
  visible: boolean;
  images: string[];
  initialIndex: number;
  onClose: () => void;
  onIndexChange?: (index: number) => void;
}

export function ImageZoomModal({
  visible,
  images,
  initialIndex,
  onClose,
  onIndexChange,
}: ImageZoomModalProps) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const { Gesture, GestureDetector } = getOptionalGestureHandlerRuntime();

  const handleIndexChange = (index: number) => {
    setCurrentIndex(index);
    onIndexChange?.(index);
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      resetTransform();
      handleIndexChange(currentIndex - 1);
    }
  };

  const goToNext = () => {
    if (currentIndex < images.length - 1) {
      resetTransform();
      handleIndexChange(currentIndex + 1);
    }
  };

  const {
    composedGesture,
    animatedImageStyle,
    resetTransform,
    resetTransformImmediate,
  } = useImageZoom({
    onClose,
    goToPrevious,
    goToNext,
    currentIndex,
    totalImages: images.length,
    gestureRuntime: { Gesture },
  });
  const zoomDecodeBounds = getImageZoomDecodeBounds({
    height: screenHeight * 0.7,
    width: screenWidth,
  });

  // Reset transforms and restore initial index each time the modal is shown
  const handleModalOpen = () => {
    setCurrentIndex(initialIndex);
    resetTransformImmediate();
  };

  const zoomableImage = (
    <Animated.View style={styles.imageWrapper}>
      <Animated.View style={[styles.imageContainer, animatedImageStyle]}>
        <Image
          source={createSafeBoundedImageSource({
            ...zoomDecodeBounds,
            uri: images[currentIndex],
          })}
          style={styles.image}
          contentFit="contain"
          autoplay={false}
          transition={200}
          placeholder={{ blurhash: BLURHASH_VARIANTS.default }}
          cachePolicy="memory-disk"
          accessibilityLabel={`Product image ${currentIndex + 1} of ${images.length}`}
        />
      </Animated.View>
    </Animated.View>
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
      onShow={handleModalOpen}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      <View style={styles.container}>
        {/* Background */}
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(200)}
          style={styles.backdrop}
        />

        {/* Header */}
        <Animated.View
          entering={FadeIn.duration(300).delay(100)}
          style={[styles.header, { paddingTop: insets.top + SPACING.sm }]}
        >
          <Pressable
            onPress={onClose}
            style={styles.closeButton}
            hitSlop={12}
            accessibilityLabel="Close image viewer"
            accessibilityRole="button"
            accessibilityHint="Double tap to close the full screen image viewer"
          >
            <Ionicons name="close" size={28} color="#FFF" />
          </Pressable>

          {images.length > 1 && (
            <View style={styles.counter}>
              <Text style={styles.counterText}>
                {currentIndex + 1} / {images.length}
              </Text>
            </View>
          )}
        </Animated.View>

        {/* Zoomable Image */}
        {GestureDetector && composedGesture ? (
          <GestureDetector gesture={composedGesture}>
            {zoomableImage}
          </GestureDetector>
        ) : (
          zoomableImage
        )}

        {/* Navigation Arrows */}
        {images.length > 1 && (
          <>
            {currentIndex > 0 && (
              <Animated.View
                entering={FadeIn.duration(200)}
                style={[styles.navButton, styles.navLeft]}
              >
                <Pressable
                  onPress={goToPrevious}
                  style={styles.navButtonInner}
                  hitSlop={16}
                  accessibilityLabel="Previous image"
                  accessibilityRole="button"
                >
                  <Ionicons name="chevron-back" size={32} color="#FFF" />
                </Pressable>
              </Animated.View>
            )}
            {currentIndex < images.length - 1 && (
              <Animated.View
                entering={FadeIn.duration(200)}
                style={[styles.navButton, styles.navRight]}
              >
                <Pressable
                  onPress={goToNext}
                  style={styles.navButtonInner}
                  hitSlop={16}
                  accessibilityLabel="Next image"
                  accessibilityRole="button"
                >
                  <Ionicons name="chevron-forward" size={32} color="#FFF" />
                </Pressable>
              </Animated.View>
            )}
          </>
        )}

        {/* Thumbnail Strip */}
        {images.length > 1 && (
          <Animated.View
            entering={FadeIn.duration(300).delay(200)}
            style={[
              styles.thumbnailStrip,
              { paddingBottom: insets.bottom + SPACING.md },
            ]}
          >
            <Animated.ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbnailContainer}
            >
              {images.map((img, idx) => (
                <Pressable
                  // biome-ignore lint/suspicious/noArrayIndexKey: image URLs have no stable ID
                  key={idx}
                  onPress={() => {
                    resetTransform();
                    handleIndexChange(idx);
                  }}
                  style={[
                    styles.thumbnail,
                    currentIndex === idx && styles.thumbnailActive,
                  ]}
                  accessibilityLabel={`Go to image ${idx + 1}`}
                  accessibilityRole="button"
                >
                  <Image
                    source={createSafeBoundedImageSource({
                      fit: 'cover',
                      height: 56,
                      uri: img,
                      width: 56,
                    })}
                    style={styles.thumbnailImage}
                    contentFit="cover"
                    autoplay={false}
                    placeholder={{ blurhash: BLURHASH_VARIANTS.default }}
                    transition={150}
                    cachePolicy="memory-disk"
                  />
                </Pressable>
              ))}
            </Animated.ScrollView>
          </Animated.View>
        )}

        {/* Zoom Hint */}
        <Animated.View
          entering={FadeIn.duration(300).delay(500)}
          style={styles.hint}
        >
          <Text style={styles.hintText}>Pinch or double-tap to zoom</Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

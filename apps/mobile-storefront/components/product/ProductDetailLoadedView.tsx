import Ionicons from '@react-native-vector-icons/ionicons';
import { router, Stack } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import type { EdgeInsets } from 'react-native-safe-area-context';
import { FlyToCartParticle } from '@/components/product/FlyToCartParticle';
import {
  ProductDetailsBody,
  type ProductDetailsBodyProps,
} from '@/components/product/ProductDetailsBody';
import {
  ProductImageGallery,
  type ProductImageGalleryProps,
} from '@/components/product/ProductImageGallery';
import {
  StickyBottomActions,
  type StickyBottomActionsProps,
} from '@/components/product/StickyBottomActions';
import type Colors from '@/constants/Colors';
import {
  MIN_STICKY_BOTTOM_PADDING,
  PRODUCT_SCROLL_BOTTOM_PADDING,
} from '@/constants/product-layout';
import type { Product } from '@/types/product';
import { productDetailScreenStyles as styles } from './ProductDetailScreen.styles';

type ColorsScheme = (typeof Colors)['light'];

interface ProductDetailLoadedViewProps {
  backButtonAnimatedStyle: ComponentProps<typeof Animated.View>['style'];
  bodyProps: ProductDetailsBodyProps;
  colors: ColorsScheme;
  flyingParticles: { id: number; startX: number; startY: number }[];
  galleryProps: ProductImageGalleryProps;
  headerAnimatedStyle: ComponentProps<typeof Animated.View>['style'];
  insets: EdgeInsets;
  isSaved: boolean;
  onScroll: ComponentProps<typeof Animated.ScrollView>['onScroll'];
  onShare: () => void;
  onWishlistPress: () => void;
  product: Product;
  savedToastState: { show: boolean; type: 'add' | 'remove'; message: string };
  showAddedToast: boolean;
  stickyProps: StickyBottomActionsProps;
}

export function ProductDetailLoadedView({
  backButtonAnimatedStyle,
  bodyProps,
  colors,
  flyingParticles,
  galleryProps,
  headerAnimatedStyle,
  insets,
  isSaved,
  onScroll,
  onShare,
  onWishlistPress,
  product,
  savedToastState,
  showAddedToast,
  stickyProps,
}: ProductDetailLoadedViewProps) {
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <Animated.View
        style={[
          styles.header,
          { height: insets.top + 46 },
          headerAnimatedStyle,
        ]}
      >
        <View style={[styles.headerContent, { marginTop: insets.top }]}>
          <Text
            style={[styles.headerTitle, { color: colors.text }]}
            numberOfLines={1}
          >
            {product.name}
          </Text>
        </View>
      </Animated.View>

      <View
        style={[
          styles.headerButtons,
          {
            top: Math.max(insets.top - 4, 0),
            left: insets.left,
            right: insets.right,
          },
        ]}
        testID="product-detail-header-actions"
      >
        <HeaderIcon
          accessibilityLabel="Go back"
          animatedStyle={backButtonAnimatedStyle}
          icon="arrow-back"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace('/')
          }
        />
        <View style={styles.headerRight}>
          <HeaderIcon
            accessibilityLabel={
              isSaved
                ? `Remove ${product.name} from saved items`
                : `Save ${product.name} for later`
            }
            animatedStyle={backButtonAnimatedStyle}
            color={isSaved ? '#EF4444' : '#FFF'}
            icon={isSaved ? 'heart' : 'heart-outline'}
            onPress={onWishlistPress}
          />
          <HeaderIcon
            accessibilityLabel="Share this product"
            animatedStyle={backButtonAnimatedStyle}
            icon="share-social-outline"
            onPress={onShare}
          />
        </View>
      </View>

      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{
          paddingBottom: PRODUCT_SCROLL_BOTTOM_PADDING + insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <ProductImageGallery {...galleryProps} />
        <ProductDetailsBody {...bodyProps} />
      </Animated.ScrollView>

      <StickyBottomActions
        {...stickyProps}
        horizontalInsets={insets}
        paddingBottom={Math.max(insets.bottom, MIN_STICKY_BOTTOM_PADDING)}
      />
      {flyingParticles.map((particle) => (
        <FlyToCartParticle
          key={particle.id}
          startX={particle.startX}
          startY={particle.startY}
        />
      ))}
      {showAddedToast && (
        <Toast
          bottom={110 + insets.bottom}
          colors={colors}
          icon="checkmark-circle"
          iconColor={colors.success}
          message="Added to your cart!"
        />
      )}
      {savedToastState.show && (
        <Toast
          bottom={110 + insets.bottom}
          colors={colors}
          icon={savedToastState.type === 'add' ? 'heart' : 'heart-dislike'}
          iconColor={
            savedToastState.type === 'add' ? '#EF4444' : colors.background
          }
          message={savedToastState.message}
        />
      )}
    </View>
  );
}

function HeaderIcon({
  accessibilityLabel,
  animatedStyle,
  color = '#FFF',
  icon,
  onPress,
}: {
  accessibilityLabel: string;
  animatedStyle: ComponentProps<typeof Animated.View>['style'];
  color?: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
}) {
  return (
    <Animated.View style={[styles.iconCircle, animatedStyle]}>
      <Pressable
        onPress={onPress}
        hitSlop={12}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
      >
        <Ionicons name={icon} size={22} color={color} />
      </Pressable>
    </Animated.View>
  );
}

function Toast({
  bottom,
  colors,
  icon,
  iconColor,
  message,
}: {
  bottom: number;
  colors: ColorsScheme;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconColor: string;
  message: string;
}) {
  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      style={[styles.toast, { backgroundColor: colors.text, bottom }]}
    >
      <Ionicons name={icon} size={20} color={iconColor} />
      <Text style={[styles.toastText, { color: colors.background }]}>
        {message}
      </Text>
    </Animated.View>
  );
}

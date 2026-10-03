import type { ImageProps } from 'expo-image';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { AnimatedStyle } from 'react-native-reanimated';
import type Colors from '@/constants/Colors';
import type { Product } from '@/types/product';

export interface BaseProductCardVariantProps {
  product: Product;
  imageSource: { uri: string };
  imageProps: Omit<ImageProps, 'source' | 'style'>;
  showLocalPlaceholder: boolean;
  handlePress: () => void;
  handleAnimateIn: () => void;
  handleAnimateOut: () => void;
  handleWishlistPress: () => void;
  handleAddToCart: () => void;
  isSaved: boolean;
  cartItemCount: number;
  animatedStyle: StyleProp<AnimatedStyle<ViewStyle>>;
  heartAnimatedStyle: StyleProp<AnimatedStyle<ViewStyle>>;
}

export interface GridProductCardProps extends BaseProductCardVariantProps {
  footer?: ReactNode;
  gridWidth: number;
  shadowColor: string;
  colors?: (typeof Colors)['light'];
}

export interface ListProductCardProps extends BaseProductCardVariantProps {
  colors?: (typeof Colors)['light'];
}

export interface EditorialProductCardProps extends BaseProductCardVariantProps {
  textColor: string;
  screenWidth: number;
  colors?: (typeof Colors)['light'];
}

import type { ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { STOREFRONT_INSET_DEFAULTS } from '@/constants/storefront-inset-defaults';

interface ScrollContentStyleOptions {
  includeBottomInset?: boolean;
  paddingBottom?: number;
  paddingTop?: number;
}

interface ListContentStyleOptions {
  gap?: number;
  includeBottomInset?: boolean;
  padding?: number;
  paddingBottom?: number;
  paddingHorizontal?: number;
  paddingTop?: number;
}

export function useStorefrontInsets() {
  const insets = useSafeAreaInsets();

  const getScrollContentStyle = (
    options: ScrollContentStyleOptions = {}
  ): ViewStyle => {
    const paddingBottom =
      (options.paddingBottom ?? STOREFRONT_INSET_DEFAULTS.scrollPaddingBottom) +
      (options.includeBottomInset === false ? 0 : insets.bottom);

    return {
      paddingBottom,
      paddingTop:
        options.paddingTop ?? STOREFRONT_INSET_DEFAULTS.scrollPaddingTop,
    };
  };

  const getListContentStyle = (
    options: ListContentStyleOptions = {}
  ): ViewStyle => {
    const bottomInset =
      options.includeBottomInset === false ? 0 : insets.bottom;

    const paddingBottomBase =
      options.paddingBottom ??
      options.padding ??
      STOREFRONT_INSET_DEFAULTS.listPaddingBottom;
    return {
      gap: options.gap ?? STOREFRONT_INSET_DEFAULTS.listGap,
      padding: options.padding ?? STOREFRONT_INSET_DEFAULTS.listPadding,
      ...(typeof options.paddingTop === 'number'
        ? { paddingTop: options.paddingTop }
        : {}),
      ...(typeof options.paddingHorizontal === 'number'
        ? { paddingHorizontal: options.paddingHorizontal }
        : {}),
      paddingBottom: paddingBottomBase + bottomInset,
    };
  };

  return {
    getListContentStyle,
    getScrollContentStyle,
    insets,
  };
}

import type React from 'react';
import { View, type ViewProps } from 'react-native';
import type { SavedItem } from '@/stores/saved-store';

export interface MockFlashListProps {
  children?: React.ReactNode;
  [key: string]: unknown;
}

export type MockStorefrontScreenShellProps = ViewProps & {
  children?: React.ReactNode;
  edges?: string[];
};

export type MockListStyleOptions = {
  gap?: number;
  includeBottomInset?: boolean;
  padding?: number;
  paddingBottom?: number;
};

export function createSavedTestItem(
  overrides: Partial<SavedItem> = {}
): SavedItem {
  return {
    id: 'saved-1',
    image: 'https://example.com/image.png',
    name: 'Test Product',
    price: 2500,
    product_id: 'product-1',
    slug: 'test-product',
    savedAt: 1700000000000,
    ...overrides,
  };
}

export function createMockExpoImageModule() {
  return {
    Image: ({
      autoplay,
      accessibilityLabel,
      style,
      testID,
    }: {
      autoplay?: boolean;
      accessibilityLabel?: string;
      style?: ViewProps['style'];
      testID?: string;
    }) => {
      const viewProps = {
        testID: testID ?? 'saved-tab-product-image',
        accessibilityLabel: accessibilityLabel ?? 'saved tab product image',
        accessibilityRole: 'image' as const,
        autoplay,
        style,
      } as unknown as React.ComponentProps<typeof View>;
      return <View {...viewProps} />;
    },
  };
}

export function createMockFlashListModule(
  onRender: (props: MockFlashListProps) => React.ReactNode
) {
  return {
    FlashList: ({
      data = [],
      renderItem,
      children,
      ...props
    }: {
      data?: SavedItem[];
      children?: React.ReactNode;
      renderItem?: (info: {
        item: SavedItem;
        index: number;
      }) => React.ReactNode;
    }) => {
      const React = require('react') as typeof import('react');
      const renderedChildren = data.length
        ? data.map((item, index) =>
            React.createElement(
              View,
              { key: item.id },
              renderItem ? renderItem({ item, index }) : null
            )
          )
        : children;

      return onRender({
        children: renderedChildren,
        ...props,
        data,
        renderItem,
      });
    },
  };
}

export function defaultListContentStyle(options?: MockListStyleOptions) {
  const bottomInset = options?.includeBottomInset === false ? 0 : 34;
  const padding = options?.padding ?? 16;

  return {
    gap: options?.gap ?? 12,
    padding,
    paddingBottom: (options?.paddingBottom ?? padding) + bottomInset,
  };
}

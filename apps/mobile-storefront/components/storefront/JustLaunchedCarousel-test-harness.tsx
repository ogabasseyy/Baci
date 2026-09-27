import { jest } from '@jest/globals';
import { act } from '@testing-library/react-native';

// Shared mocks, builders, and module factories for the JustLaunchedCarousel
// suites (core + ad slots). Pure module on purpose: jest.mock hoisting is
// per-file, so each suite registers its own mocks from these factories and
// mock handles. Factories are mock-prefixed because factory bodies may only
// reference mock-prefixed imports.

export const mockPush = jest.fn();
export const mockUseProducts = jest.fn();
export const mockUsePinned = jest.fn();
export const mockImage = jest.fn();
export const mockCaptureViewability = jest.fn();
export const mockUseMobileAdsReadiness = jest.fn(() => ({
  canRequestAds: true,
  initialized: true,
}));

export function mockExpoImageModule(): unknown {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    Image: (props: Record<string, unknown>) => {
      mockImage(props);
      return React.createElement('Image', props);
    },
  };
}

export function mockReactNativeModule(): unknown {
  const React = jest.requireActual<typeof import('react')>('react');
  const actual =
    jest.requireActual<typeof import('react-native')>('react-native');
  const mocked = Object.defineProperties(
    {},
    Object.getOwnPropertyDescriptors(actual)
  );
  Object.defineProperties(mocked, {
    FlatList: {
      configurable: true,
      value: ({
        data,
        keyExtractor,
        onViewableItemsChanged,
        renderItem,
      }: {
        data: unknown[];
        keyExtractor: (item: unknown, index: number) => string;
        onViewableItemsChanged?: (info: {
          viewableItems: Array<{ index?: number; isViewable?: boolean }>;
        }) => void;
        renderItem: (info: { item: unknown }) => React.ReactNode;
      }) => {
        mockCaptureViewability(onViewableItemsChanged);
        return React.createElement(
          React.Fragment,
          null,
          data.map((item, index) =>
            React.createElement(
              React.Fragment,
              { key: keyExtractor(item, index) },
              renderItem({ item })
            )
          )
        );
      },
    },
    PixelRatio: { configurable: true, value: { get: () => 2 } },
    Pressable: {
      configurable: true,
      value: ({
        children,
        ...props
      }: React.ComponentProps<typeof actual.View>) =>
        React.createElement(
          actual.View,
          { ...props, accessible: true },
          children
        ),
    },
    useWindowDimensions: {
      configurable: true,
      value: () => ({ fontScale: 1, height: 800, scale: 2, width: 400 }),
    },
  });
  return mocked;
}

export function mockThemeModule(): unknown {
  return {
    useTheme: () => ({
      colors: {
        card: '#ffffff',
        background: '#ffffff',
        text: '#000000',
        textSecondary: '#666666',
        primary: '#d62027',
        border: '#cccccc',
      },
    }),
  };
}

export function mockSkeletonModule(): unknown {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Skeleton: () => <View accessibilityRole="progressbar" accessible />,
  };
}

export const a27 = {
  id: 'a27',
  name: 'Samsung Galaxy A27 5G Preorder',
  slug: 'samsung-galaxy-a27-5g',
  price: 50000,
  image: 'https://cdn.ogabassey.com/core-assets/products/a27.avif',
};
export const xiaomi = {
  id: 'xiaomi',
  name: 'Xiaomi 17T',
  slug: 'xiaomi-17t',
  price: 800000,
  image: 'https://cdn.ogabassey.com/core-assets/products/xiaomi.avif',
};

export type ViewabilityInfo = {
  viewableItems: Array<{
    index?: number;
    isViewable?: boolean;
    item?: unknown;
  }>;
};

export function latestViewabilityHandler():
  | ((info: ViewabilityInfo) => void)
  | undefined {
  const calls = mockCaptureViewability.mock.calls;
  return calls.at(-1)?.[0] as ((info: ViewabilityInfo) => void) | undefined;
}

export function showAdCard(): void {
  act(() => {
    latestViewabilityHandler()?.({
      viewableItems: [
        { index: 1, isViewable: true, item: { kind: 'launch-ad-card' } },
      ],
    });
  });
}

export function hideAdCard(): void {
  act(() => {
    latestViewabilityHandler()?.({ viewableItems: [] });
  });
}

export function setupCarouselMocks(): void {
  jest.clearAllMocks();
  mockUsePinned.mockReturnValue({ data: [], isLoading: false });
  mockUseProducts.mockReturnValue({
    products: [],
    isLoading: false,
    isError: false,
  });
  mockUseMobileAdsReadiness.mockReturnValue({
    canRequestAds: true,
    initialized: true,
  });
}

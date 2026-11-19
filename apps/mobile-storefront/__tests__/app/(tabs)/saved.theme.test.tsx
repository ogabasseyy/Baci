import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import SavedTabScreen from '@/app/(tabs)/saved';
import Colors, { BRAND } from '@/constants/Colors';
import type { SavedItem } from '@/stores/saved-store';
import {
  createSavedTestItem,
  type MockFlashListProps,
  type MockStorefrontScreenShellProps,
} from './saved.test-utils';

const mockColorScheme = jest.fn<() => 'light' | 'dark'>();
const mockSavedStore = jest.fn<() => SavedItem[]>();

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));
jest.mock('expo-image', () =>
  (
    require('./saved.test-utils') as typeof import('./saved.test-utils')
  ).createMockExpoImageModule()
);
jest.mock('@shopify/flash-list', () =>
  (
    require('./saved.test-utils') as typeof import('./saved.test-utils')
  ).createMockFlashListModule(({ children, ...props }: MockFlashListProps) => {
    const React = require('react') as typeof import('react');
    const { View } = require('react-native') as typeof import('react-native');
    return React.createElement(
      View,
      { testID: 'saved-flash-list', ...props },
      children
    );
  })
);
jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: ({
    children,
    ...props
  }: MockStorefrontScreenShellProps) => {
    const React = require('react') as typeof import('react');
    const { View } = require('react-native') as typeof import('react-native');
    return React.createElement(
      View,
      { testID: 'storefront-screen-shell', ...props },
      children
    );
  },
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => mockColorScheme(),
}));
jest.mock('@/hooks/use-storefront-insets', () => ({
  useStorefrontInsets: () => ({
    getScrollContentStyle: jest.fn(),
    getListContentStyle: (
      require('./saved.test-utils') as typeof import('./saved.test-utils')
    ).defaultListContentStyle,
  }),
}));
jest.mock('@/hooks/use-network-state', () => ({
  useNetworkState: () => ({ isOnline: true, refresh: jest.fn() }),
}));
jest.mock('@/stores/saved-store', () => ({
  useSavedStore: (
    selector: (state: {
      items: SavedItem[];
      removeItem: (productId: string) => void;
    }) => unknown
  ) => selector({ items: mockSavedStore(), removeItem: jest.fn() }),
}));

describe('SavedTabScreen theme tokens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockColorScheme.mockReturnValue('light');
  });

  it('uses BRAND.onPrimary on the empty-state browse button label', () => {
    mockSavedStore.mockReturnValue([]);

    render(<SavedTabScreen />);

    expect(screen.getByText('Browse Products').props.style).toEqual(
      expect.arrayContaining([{ color: BRAND.onPrimary }])
    );
  });

  it('uses Colors.light.muted as the product thumbnail background in light mode', () => {
    mockColorScheme.mockReturnValue('light');
    mockSavedStore.mockReturnValue([createSavedTestItem()]);

    render(<SavedTabScreen />);

    expect(screen.getByTestId('saved-tab-product-image').props.style).toEqual(
      expect.arrayContaining([{ backgroundColor: Colors.light.muted }])
    );
  });

  it('uses Colors.dark.muted as the product thumbnail background in dark mode', () => {
    mockColorScheme.mockReturnValue('dark');
    mockSavedStore.mockReturnValue([createSavedTestItem()]);

    render(<SavedTabScreen />);

    expect(screen.getByTestId('saved-tab-product-image').props.style).toEqual(
      expect.arrayContaining([{ backgroundColor: Colors.dark.muted }])
    );
  });
});

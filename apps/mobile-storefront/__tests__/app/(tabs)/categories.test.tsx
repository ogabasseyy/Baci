import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import CategoriesScreen from '@/app/(tabs)/categories';

interface MockStorefrontScreenShellProps {
  children?: React.ReactNode;
  edges?: string[];
}

const mockPush = jest.fn();
const mockRefetch = jest.fn();
const mockUseCategories = jest.fn();
const mockUseNetworkState = jest.fn();
const mockImage = jest.fn((_props: unknown) => null);
const mockStorefrontScreenShell = jest.fn(
  ({ children }: MockStorefrontScreenShellProps) => (
    <View testID="storefront-screen-shell">{children}</View>
  )
);

function expectTabShell() {
  expect(mockStorefrontScreenShell).toHaveBeenCalledWith(
    expect.objectContaining({
      edges: ['top'],
    })
  );
}

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
  },
}));

jest.mock('@react-native-vector-icons/ionicons', () => () => null);

jest.mock('expo-image', () => ({
  Image: (props: unknown) => mockImage(props),
}));

jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: ({
    children,
    ...props
  }: MockStorefrontScreenShellProps) =>
    mockStorefrontScreenShell({ children, ...props }),
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/hooks', () => ({
  useCategories: () => mockUseCategories(),
}));

jest.mock('@/hooks/use-network-state', () => ({
  useNetworkState: () => mockUseNetworkState(),
}));

jest.mock('@/components/OfflineNotice', () => ({
  OfflineEmptyState: ({ title }: { title: string }) => {
    const React = jest.requireActual('react') as typeof import('react');
    const { Text } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');

    return React.createElement(Text, null, title);
  },
  OfflineNotice: () => {
    const React = jest.requireActual('react') as typeof import('react');
    const { Text } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');

    return React.createElement(Text, null, 'Offline notice');
  },
}));

import { BRAND } from '@/constants/Colors';

describe('CategoriesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseNetworkState.mockReturnValue({ isOnline: true });
    mockUseCategories.mockReturnValue({
      data: [{ id: 'category-1', slug: 'phones', name: 'Phones' }],
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      isRefetching: false,
    });
  });

  it('uses the tab shell for the category list', () => {
    render(<CategoriesScreen />);

    expect(screen.getByText('Phones')).toBeOnTheScreen();
    expectTabShell();
  });

  it('uses a bundled category fallback image when image_url is missing', () => {
    render(<CategoriesScreen />);

    expect(mockImage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.not.objectContaining({
          uri: expect.stringContaining('placehold.co'),
        }),
        autoplay: false,
      })
    );
  });

  it('uses the remote category image when image_url is present', () => {
    mockUseCategories.mockReturnValue({
      data: [
        {
          id: 'category-1',
          slug: 'phones',
          name: 'Phones',
          image_url: 'https://cdn.example.com/categories/phones.png',
        },
      ],
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      isRefetching: false,
    });

    render(<CategoriesScreen />);

    expect(mockImage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { uri: 'https://cdn.example.com/categories/phones.png' },
        autoplay: false,
      })
    );
  });

  it('uses the tab shell while categories are loading', () => {
    mockUseCategories.mockReturnValue({
      data: [],
      isLoading: true,
      isError: false,
      refetch: mockRefetch,
      isRefetching: false,
    });

    render(<CategoriesScreen />);

    expectTabShell();
  });

  it('uses the tab shell for the online error state', () => {
    mockUseNetworkState.mockReturnValue({ isOnline: true });
    mockUseCategories.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      refetch: mockRefetch,
      isRefetching: false,
    });

    render(<CategoriesScreen />);

    expect(screen.getByText('Something went wrong')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
    expectTabShell();
  });

  it('uses the tab shell for the offline error state', () => {
    mockUseNetworkState.mockReturnValue({ isOnline: false });
    mockUseCategories.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      refetch: mockRefetch,
      isRefetching: false,
    });

    render(<CategoriesScreen />);

    expect(screen.getByText("Can't load categories")).toBeOnTheScreen();
    expectTabShell();
  });

  it('applies correct theme colors to error states', () => {
    mockUseNetworkState.mockReturnValue({ isOnline: true });
    mockUseCategories.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      refetch: mockRefetch,
      isRefetching: false,
    });

    render(<CategoriesScreen />);

    const retryButtonText = screen.getByText('Try Again');
    expect(retryButtonText.props.style).toEqual(
      expect.objectContaining({ color: BRAND.onPrimary })
    );
  });
});

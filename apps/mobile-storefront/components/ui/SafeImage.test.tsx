import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { SafeImage } from './SafeImage';

let mockColorScheme: 'dark' | 'light' | null = 'light';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => mockColorScheme,
}));

jest.mock('@react-native-vector-icons/ionicons', () => {
  const { Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return function MockIonicons({
    color,
    name,
  }: {
    color: string;
    name: string;
  }) {
    return <Text testID="fallback-icon">{`${name}:${color}`}</Text>;
  };
});

jest.mock('expo-image', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    Image: ({
      onError,
      onLoadStart,
      autoplay,
      accessibilityLabel,
      source,
      testID,
    }: {
      onError?: (error: { error: string }) => void;
      onLoadStart?: () => void;
      autoplay?: boolean;
      accessibilityLabel?: string;
      source?: unknown;
      testID?: string;
    }) => {
      const viewProps = {
        testID,
        onError,
        onLoadStart,
        autoplay,
        source,
        accessible: true,
        accessibilityRole: 'image',
        accessibilityLabel,
      } as unknown as React.ComponentProps<typeof View>;
      return <View {...viewProps} />;
    },
  };
});

describe('SafeImage', () => {
  beforeEach(() => {
    mockColorScheme = 'light';
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the active theme tokens for the fallback background and icon', () => {
    mockColorScheme = 'dark';

    render(
      <SafeImage
        testID="product-image"
        source={{ uri: 'https://example.com/missing.png' }}
      />
    );

    fireEvent(screen.getByTestId('product-image'), 'error', {
      error: 'not found',
    });

    const fallback = screen.getByLabelText('Image unavailable');
    expect(StyleSheet.flatten(fallback.props.style)).toMatchObject({
      backgroundColor: Colors.dark.muted,
    });
    expect(screen.getByTestId('fallback-icon').props.children).toBe(
      `image-outline:${Colors.dark.textSecondary}`
    );
  });

  it('does not autoplay animated remote images', () => {
    render(
      <SafeImage
        testID="product-image"
        accessibilityLabel="catalog image"
        source={{ uri: 'https://example.com/catalog.gif' }}
      />
    );

    expect(
      screen.getByRole('image', { name: 'catalog image' }).props.autoplay
    ).toBe(false);
  });

  it('uses a static bounded fallback for managed AVIF catalog images', () => {
    render(
      <SafeImage
        testID="product-image"
        source={{
          height: 120,
          uri: 'https://cdn.ogabassey.com/core-assets/products/phone.avif',
          width: 100,
        }}
      />
    );

    expect(screen.getByTestId('product-image').props.source).toEqual({
      height: 120,
      uri: 'https://cdn.ogabassey.com/image/width=100,height=120,quality=82,format=webp,fit=cover/core-assets/products/phone.avif',
      width: 100,
    });
  });

  describe('bugfix: caller onLoadStart overwritten by SafeImage handler', () => {
    it('invokes the caller onLoadStart callback when load starts', () => {
      const onLoadStart = jest.fn();

      render(
        <SafeImage
          testID="product-image"
          accessibilityLabel="catalog image"
          source={{ uri: 'https://example.com/catalog.gif' }}
          onLoadStart={onLoadStart}
        />
      );

      fireEvent(screen.getByTestId('product-image'), 'loadStart');

      expect(onLoadStart).toHaveBeenCalledTimes(1);
    });
  });

  it('lets callers override the fallback icon color', () => {
    render(
      <SafeImage
        testID="product-image"
        source={{ uri: 'https://example.com/missing.png' }}
        fallbackIconColor="#123456"
      />
    );

    fireEvent(screen.getByTestId('product-image'), 'error', {
      error: 'not found',
    });

    expect(screen.getByTestId('fallback-icon').props.children).toBe(
      'image-outline:#123456'
    );
  });
});

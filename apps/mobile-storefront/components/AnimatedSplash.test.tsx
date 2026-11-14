import { jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { AnimatedSplash } from './AnimatedSplash';

// Mock Reanimated cleanly
jest.mock('react-native-reanimated', () => {
  const { View, Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  const makeSharedValue = (init: number) => {
    let _value = init;
    return {
      get value() {
        return _value;
      },
      set value(v: number) {
        _value = v;
      },
      get: () => _value,
      set: (v: number) => {
        _value = v;
      },
    };
  };

  return {
    default: { View, Text },
    View,
    Text,
    cancelAnimation: jest.fn(),
    Easing: {
      in: jest.fn(),
      inOut: jest.fn(),
      ease: jest.fn(),
      cubic: jest.fn(),
    },
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
    useSharedValue: makeSharedValue,
    useAnimatedStyle: () => ({}),
    withDelay: (_delay: number, anim: unknown) => anim,
    withRepeat: (anim: unknown) => anim,
    withSequence: (...anims: unknown[]) => anims[0],
    withTiming: (value: number, _config?: unknown, callback?: () => void) => {
      if (callback) callback();
      return value;
    },
  };
});

// Mock expo-image
jest.mock('expo-image', () => ({
  Image: 'Image',
}));

describe('AnimatedSplash', () => {
  it('renders children correctly and renders the splash branding elements', () => {
    const onAnimationEnd = jest.fn();

    render(
      <AnimatedSplash isReady={false} onAnimationEnd={onAnimationEnd}>
        <View testID="test-children">
          <Text>Store Content</Text>
        </View>
      </AnimatedSplash>
    );

    // Assert that the underlying storefront screen content is mounted/rendered
    expect(screen.getByTestId('test-children')).toBeTruthy();
    expect(screen.getByText('Store Content')).toBeTruthy();

    // Assert that the splash overlay branding text exists
    expect(screen.getByText('Buy Now, Pay Later')).toBeTruthy();
  });

  it('triggers onAnimationEnd when isReady becomes true', async () => {
    const onAnimationEnd = jest.fn();

    const { rerender } = render(
      <AnimatedSplash isReady={false} onAnimationEnd={onAnimationEnd}>
        <View />
      </AnimatedSplash>
    );

    expect(onAnimationEnd).not.toHaveBeenCalled();

    // Rerender with isReady: true
    rerender(
      <AnimatedSplash isReady={true} onAnimationEnd={onAnimationEnd}>
        <View />
      </AnimatedSplash>
    );

    await act(async () => {
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    });

    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
  });
});

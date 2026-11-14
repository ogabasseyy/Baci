import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import * as imageZoomHook from './hooks/useImageZoom';
import { ImageZoomModal } from './ImageZoomModal';

jest.mock('react-native-reanimated', () => {
  const { View, ScrollView } =
    jest.requireActual<typeof import('react-native')>('react-native');
  const makeSharedValue = (initial: number) => ({
    value: initial,
    get: () => initial,
    set: (value: number) => value,
  });
  return {
    default: { View, ScrollView },
    View,
    ScrollView,
    FadeIn: { duration: () => ({ delay: () => ({}) }) },
    FadeOut: { duration: () => ({}) },
    runOnJS: (callback: (...args: unknown[]) => unknown) => callback,
    useSharedValue: makeSharedValue,
    useAnimatedStyle: () => ({}),
    withSpring: (value: number) => value,
    makeWorklet: (callback: (...args: unknown[]) => unknown) => callback,
  };
});

jest.mock('react-native-gesture-handler', () => {
  const gesture = () => {
    const value: Record<string, () => typeof value> = {};
    for (const method of [
      'onStart',
      'onUpdate',
      'onEnd',
      'onBegin',
      'onFinalize',
      'numberOfTaps',
      'minPointers',
      'maxPointers',
      'simultaneousWithExternalGesture',
      'blocksExternalGesture',
      'withRef',
    ])
      value[method] = () => value;
    return value;
  };
  return {
    Gesture: {
      Pinch: gesture,
      Pan: gesture,
      Tap: gesture,
      Simultaneous: gesture,
      Race: gesture,
    },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView',
  };
});
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/components/storefront/ProductCard', () => ({
  BLURHASH_VARIANTS: { default: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' },
}));

const images = ['https://example.com/image.jpg'];
const renderModal = (visible: boolean) =>
  render(
    <ImageZoomModal
      visible={visible}
      images={images}
      initialIndex={0}
      onClose={jest.fn()}
      onIndexChange={jest.fn()}
    />
  );

it('does not initialize zoom gestures while the viewer is closed', () => {
  const spy = jest.spyOn(imageZoomHook, 'useImageZoom');
  renderModal(false);
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});

it('unmounts the active viewer and skips gesture setup when closed', () => {
  const spy = jest.spyOn(imageZoomHook, 'useImageZoom');
  try {
    const { rerender } = renderModal(true);
    expect(spy).toHaveBeenCalled();
    spy.mockClear();
    rerender(
      <ImageZoomModal
        visible={false}
        images={images}
        initialIndex={0}
        onClose={jest.fn()}
        onIndexChange={jest.fn()}
      />
    );
    expect(
      screen.queryByRole('button', { name: 'Close image viewer' })
    ).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

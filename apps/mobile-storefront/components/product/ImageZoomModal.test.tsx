/**
 * Tests for ImageZoomModal
 *
 * Scope: rendering, close button, image counter, navigation arrows,
 * thumbnail strip, and onIndexChange callback.
 *
 * Out of scope: actual gesture simulation (pinch/pan/double-tap) because
 * Reanimated worklets run on the UI thread and cannot be driven in Jest.
 */

import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as imageZoomHook from './hooks/useImageZoom';
import { ImageZoomModal } from './ImageZoomModal';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// react-native-reanimated — hand-rolled mock.
// The official react-native-reanimated/mock transitively imports
// react-native-worklets which requires native bindings; it cannot run in Jest.
// We mock only what ImageZoomModal actually imports.
jest.mock('react-native-reanimated', () => {
  const { View, ScrollView } =
    jest.requireActual<typeof import('react-native')>('react-native');

  // Shared value: a simple object with .get()/.set() so worklet calls are no-ops
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
      set: (v: number | ((prev: number) => number)) => {
        _value = typeof v === 'function' ? v(_value) : v;
      },
    };
  };

  return {
    default: { View, ScrollView },
    // Animated host components — delegate to plain RN equivalents
    View,
    ScrollView,
    // FadeIn / FadeOut — animation entry/exit descriptors; no-op in tests
    FadeIn: { duration: () => ({ delay: () => ({}) }) },
    FadeOut: { duration: () => ({}) },
    // runOnJS — just call the function directly on the JS thread
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
    // useSharedValue — plain JS object, no native thread
    useSharedValue: makeSharedValue,
    // useAnimatedStyle — returns an empty style object; we don't test transforms
    useAnimatedStyle: (_fn: () => Record<string, unknown>) => ({}),
    // withSpring — identity: return the target value immediately
    withSpring: (value: number, _config?: Record<string, unknown>) => value,
    // Worklet directive is stripped by Babel in test; no-op here for safety
    makeWorklet: (fn: (...args: unknown[]) => unknown) => fn,
  };
});

// react-native-gesture-handler — stub Gesture builder and GestureDetector.
// IMPORTANT: Do NOT use JSX inside jest.mock() factories. Babel's nativewind
// JSX transform rewrites React.createElement to _ReactNativeCSSInterop.createInteropElement
// which is a hoisted variable that isn't available inside the jest.mock() scope.
// Use plain string tags instead — RNTL renders them as host components.
jest.mock('react-native-gesture-handler', () => {
  const gestureObject = () => {
    const obj: Record<string, () => typeof obj> = {};
    const methods = [
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
    ];
    for (const m of methods) {
      obj[m] = () => obj;
    }
    return obj;
  };

  return {
    Gesture: {
      Pinch: gestureObject,
      Pan: gestureObject,
      Tap: gestureObject,
      Simultaneous: () => gestureObject(),
      Race: () => gestureObject(),
    },
    // Use string component names — Babel won't transform these through the
    // css-interop JSX runtime. RNTL renders them as opaque host nodes.
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView',
  };
});

// expo-image — forward to RN Image so accessibilityLabel queries work.
// Use a named function (not an arrow function with JSX) to avoid the
// "out-of-scope variable" restriction inside jest.mock() factory scope.
jest.mock('expo-image', () => ({
  Image: 'Image',
}));

// react-native-safe-area-context — return zero insets so layout is predictable.
// Only export what ImageZoomModal actually uses (useSafeAreaInsets).
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// ProductCard dependency — just export BLURHASH_VARIANTS constant
jest.mock('@/components/storefront/ProductCard', () => ({
  BLURHASH_VARIANTS: { default: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' },
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const IMAGES = [
  'https://example.com/image1.jpg',
  'https://example.com/image2.jpg',
  'https://example.com/image3.jpg',
];

const SINGLE_IMAGE = ['https://example.com/image1.jpg'];

function renderModal(
  props: Partial<React.ComponentProps<typeof ImageZoomModal>> = {}
) {
  const defaults = {
    visible: true,
    images: IMAGES,
    initialIndex: 0,
    onClose: jest.fn(),
    onIndexChange: jest.fn(),
  };
  return render(<ImageZoomModal {...defaults} {...props} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImageZoomModal', () => {
  describe('visibility', () => {
    it('renders the close button when visible is true', () => {
      renderModal({ visible: true });
      expect(
        screen.getByRole('button', { name: 'Close image viewer' })
      ).toBeTruthy();
    });

    it('does not render close button when visible is false', () => {
      renderModal({ visible: false });
      expect(
        screen.queryByRole('button', { name: 'Close image viewer' })
      ).toBeNull();
    });

    it('renders without a gesture wrapper when no composed gesture is available', () => {
      const spy = jest.spyOn(imageZoomHook, 'useImageZoom');
      spy.mockReturnValue({
        composedGesture: null,
        animatedImageStyle: {},
        resetTransform: jest.fn(),
        resetTransformImmediate: jest.fn(),
      });

      renderModal({ visible: true });

      expect(screen.getByLabelText('Product image 1 of 3')).toBeTruthy();

      spy.mockRestore();
    });
  });

  describe('close button', () => {
    it('calls onClose when the close button is pressed', () => {
      const onClose = jest.fn();
      renderModal({ onClose });

      fireEvent.press(
        screen.getByRole('button', { name: 'Close image viewer' })
      );

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('image counter', () => {
    it('shows image counter text for multiple images', () => {
      renderModal({ images: IMAGES, initialIndex: 0 });
      expect(screen.getByText('1 / 3')).toBeTruthy();
    });

    it('shows the correct counter when initialIndex is not 0', () => {
      renderModal({ images: IMAGES, initialIndex: 2 });
      expect(screen.getByText('3 / 3')).toBeTruthy();
    });

    it('does not show a counter for a single image', () => {
      renderModal({ images: SINGLE_IMAGE, initialIndex: 0 });
      expect(screen.queryByText('1 / 1')).toBeNull();
    });
  });

  describe('navigation arrows', () => {
    it('does not show navigation arrows for a single image', () => {
      renderModal({ images: SINGLE_IMAGE, initialIndex: 0 });
      expect(
        screen.queryByRole('button', { name: 'Previous image' })
      ).toBeNull();
      expect(screen.queryByRole('button', { name: 'Next image' })).toBeNull();
    });

    it('shows only the Next arrow when on the first image of multiple', () => {
      renderModal({ images: IMAGES, initialIndex: 0 });
      expect(
        screen.queryByRole('button', { name: 'Previous image' })
      ).toBeNull();
      expect(screen.getByRole('button', { name: 'Next image' })).toBeTruthy();
    });

    it('shows only the Previous arrow when on the last image', () => {
      renderModal({ images: IMAGES, initialIndex: 2 });
      expect(
        screen.getByRole('button', { name: 'Previous image' })
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Next image' })).toBeNull();
    });

    it('shows both arrows when on a middle image', () => {
      renderModal({ images: IMAGES, initialIndex: 1 });
      expect(
        screen.getByRole('button', { name: 'Previous image' })
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Next image' })).toBeTruthy();
    });
  });

  describe('navigation — Next button', () => {
    it('advances to the next image when Next is pressed', () => {
      renderModal({ images: IMAGES, initialIndex: 0 });

      fireEvent.press(screen.getByRole('button', { name: 'Next image' }));

      // Counter updates to reflect image 2 of 3
      expect(screen.getByText('2 / 3')).toBeTruthy();
    });

    it('calls onIndexChange with the new index when Next is pressed', () => {
      const onIndexChange = jest.fn();
      renderModal({ images: IMAGES, initialIndex: 0, onIndexChange });

      fireEvent.press(screen.getByRole('button', { name: 'Next image' }));

      expect(onIndexChange).toHaveBeenCalledWith(1);
    });

    it('does not advance past the last image', () => {
      renderModal({ images: IMAGES, initialIndex: 2 });
      // Next button should not be present on the last image
      expect(screen.queryByRole('button', { name: 'Next image' })).toBeNull();
    });
  });

  describe('navigation — Previous button', () => {
    it('goes back to the previous image when Previous is pressed', () => {
      renderModal({ images: IMAGES, initialIndex: 1 });

      fireEvent.press(screen.getByRole('button', { name: 'Previous image' }));

      // Counter updates to reflect image 1 of 3
      expect(screen.getByText('1 / 3')).toBeTruthy();
    });

    it('calls onIndexChange with the new index when Previous is pressed', () => {
      const onIndexChange = jest.fn();
      renderModal({ images: IMAGES, initialIndex: 2, onIndexChange });

      fireEvent.press(screen.getByRole('button', { name: 'Previous image' }));

      expect(onIndexChange).toHaveBeenCalledWith(1);
    });

    it('does not go before the first image', () => {
      renderModal({ images: IMAGES, initialIndex: 0 });
      // Previous button should not be present on the first image
      expect(
        screen.queryByRole('button', { name: 'Previous image' })
      ).toBeNull();
    });
  });

  describe('thumbnail strip navigation', () => {
    it('renders thumbnail buttons for each image when there are multiple', () => {
      renderModal({ images: IMAGES, initialIndex: 0 });

      // Each thumbnail has an accessibility label "Go to image N"
      expect(
        screen.getByRole('button', { name: 'Go to image 1' })
      ).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Go to image 2' })
      ).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Go to image 3' })
      ).toBeTruthy();
    });

    it('does not render a thumbnail strip for a single image', () => {
      renderModal({ images: SINGLE_IMAGE, initialIndex: 0 });
      expect(
        screen.queryByRole('button', { name: 'Go to image 1' })
      ).toBeNull();
    });

    it('changes the active image when a thumbnail is pressed', () => {
      renderModal({ images: IMAGES, initialIndex: 0 });

      fireEvent.press(screen.getByRole('button', { name: 'Go to image 3' }));

      expect(screen.getByText('3 / 3')).toBeTruthy();
    });

    it('calls onIndexChange when a thumbnail is pressed', () => {
      const onIndexChange = jest.fn();
      renderModal({ images: IMAGES, initialIndex: 0, onIndexChange });

      fireEvent.press(screen.getByRole('button', { name: 'Go to image 2' }));

      expect(onIndexChange).toHaveBeenCalledWith(1);
    });
  });

  describe('zoom hint', () => {
    it('renders the zoom hint text', () => {
      renderModal({ visible: true });
      expect(screen.getByText('Pinch or double-tap to zoom')).toBeTruthy();
    });
  });

  describe('image accessibility', () => {
    it('renders the current image with a descriptive accessibility label', () => {
      renderModal({ images: IMAGES, initialIndex: 0 });
      expect(screen.getByLabelText('Product image 1 of 3')).toBeTruthy();
    });

    it('updates the image accessibility label after navigating to the next image', () => {
      renderModal({ images: IMAGES, initialIndex: 0 });

      fireEvent.press(screen.getByRole('button', { name: 'Next image' }));

      expect(screen.getByLabelText('Product image 2 of 3')).toBeTruthy();
    });
  });

  describe('onIndexChange is optional', () => {
    it('does not throw when onIndexChange is not provided and navigation occurs', () => {
      // Render without onIndexChange prop
      const { getByRole } = render(
        <ImageZoomModal
          visible={true}
          images={IMAGES}
          initialIndex={0}
          onClose={jest.fn()}
        />
      );

      expect(() =>
        fireEvent.press(getByRole('button', { name: 'Next image' }))
      ).not.toThrow();
    });
  });
});

import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

// Inline reanimated mock — Jest hoists `jest.mock` factories above all
// imports, so the factory must not reference any out-of-scope identifiers
// (no captured types, no closure values).
jest.mock('react-native-reanimated', () => {
  const { useRef } = jest.requireActual<typeof import('react')>('react');
  const makeShared = (initial: number) => {
    let current = initial;
    return {
      get: () => current,
      set: (next: number) => {
        current = next;
      },
    };
  };
  return {
    __esModule: true,
    default: {},
    useSharedValue: (initial: number) => useRef(makeShared(initial)).current,
    useAnimatedStyle: (factory: () => { transform: unknown }) => ({
      get transform() {
        return factory().transform;
      },
    }),
    withSpring: (value: number) => value,
    withTiming: (value: number) => value,
    runOnJS:
      <Args extends unknown[]>(fn: (...args: Args) => unknown) =>
      (...args: Args) =>
        fn(...args),
  };
});

// SPRING_CONFIG comes from the constants barrel; mock it minimally so the hook
// can read `.snappy` without pulling in native deps.
jest.mock('@/constants/Colors', () => ({
  SPRING_CONFIG: { snappy: { damping: 1, stiffness: 1 } },
}));

import { useImageZoom } from './useImageZoom';

type GestureHandler = (event?: unknown) => void;

interface MockGestureBuilder {
  onStart: (handler: GestureHandler) => MockGestureBuilder;
  onUpdate: (handler: GestureHandler) => MockGestureBuilder;
  onEnd: (handler: GestureHandler) => MockGestureBuilder;
  numberOfTaps: (count: number) => MockGestureBuilder;
  minPointers: (count: number) => MockGestureBuilder;
  maxPointers: (count: number) => MockGestureBuilder;
  __kind: string;
  // Handler captures so tests can drive synthetic events through the
  // builder without standing up the real gesture-handler runtime.
  __handlers: {
    start?: GestureHandler;
    update?: GestureHandler;
    end?: GestureHandler;
  };
}

function makeBuilder(kind: string): MockGestureBuilder {
  const obj: MockGestureBuilder = {
    __kind: kind,
    __handlers: {},
    onStart: (handler) => {
      obj.__handlers.start = handler;
      return obj;
    },
    onUpdate: (handler) => {
      obj.__handlers.update = handler;
      return obj;
    },
    onEnd: (handler) => {
      obj.__handlers.end = handler;
      return obj;
    },
    numberOfTaps: () => obj,
    minPointers: () => obj,
    maxPointers: () => obj,
  };
  return obj;
}

function makeMockGestureFactory() {
  // Captures every builder so tests can fish out a specific gesture (pan,
  // pinch, tap) and invoke its registered handlers directly.
  const builders: MockGestureBuilder[] = [];
  const track = (kind: string) => {
    const builder = makeBuilder(kind);
    builders.push(builder);
    return builder;
  };

  const factory = {
    Pinch: () => track('pinch'),
    Pan: () => track('pan'),
    Tap: () => track('tap'),
    Race: (...children: unknown[]) => ({ __kind: 'race', children }),
    Simultaneous: (...children: unknown[]) => ({
      __kind: 'simultaneous',
      children,
    }),
  } as unknown as NonNullable<
    Parameters<typeof useImageZoom>[0]['gestureRuntime']['Gesture']
  > & { __builders: MockGestureBuilder[] };

  // Attach the capture array under a non-typed property so tests can read it
  // without polluting the public Gesture surface.
  Object.defineProperty(factory, '__builders', {
    value: builders,
    enumerable: false,
  });

  return factory;
}

const buildParams = (
  overrides: Partial<Parameters<typeof useImageZoom>[0]> = {}
) => {
  return {
    onClose: jest.fn(),
    goToPrevious: jest.fn(),
    goToNext: jest.fn(),
    currentIndex: 0,
    totalImages: 3,
    viewportHeight: 800,
    viewportWidth: 400,
    gestureRuntime: { Gesture: makeMockGestureFactory() },
    ...overrides,
  } satisfies Parameters<typeof useImageZoom>[0];
};

describe('useImageZoom', () => {
  it('reclamps an existing zoomed pan after the viewport shrinks', () => {
    const factory = makeMockGestureFactory();
    const params = buildParams({ gestureRuntime: { Gesture: factory } });
    const { result, rerender } = renderHook(useImageZoom, {
      initialProps: params,
    });
    const pinch = factory.__builders.find(({ __kind }) => __kind === 'pinch');
    const pan = factory.__builders.find(({ __kind }) => __kind === 'pan');
    act(() => {
      pinch?.__handlers.start?.();
      pinch?.__handlers.update?.({ scale: 2, focalX: 0, focalY: 0 });
      pinch?.__handlers.end?.();
      pan?.__handlers.start?.();
      pan?.__handlers.update?.({ translationX: 170, translationY: -340 });
    });
    expect(result.current.animatedImageStyle).toMatchObject({
      transform: [{ translateX: 170 }, { translateY: -340 }, { scale: 2 }],
    });

    rerender({ ...params, viewportWidth: 220, viewportHeight: 500 });
    expect(result.current.animatedImageStyle).toMatchObject({
      transform: [{ translateX: 110 }, { translateY: -250 }, { scale: 2 }],
    });
  });

  it('returns null composedGesture when Gesture runtime is not available', () => {
    const { result } = renderHook(() =>
      useImageZoom(
        buildParams({
          gestureRuntime: { Gesture: null },
        })
      )
    );

    expect(result.current.composedGesture).toBeNull();
    expect(typeof result.current.resetTransform).toBe('function');
    expect(typeof result.current.resetTransformImmediate).toBe('function');
  });

  it('builds a composed gesture when the Gesture runtime is provided', () => {
    const { result } = renderHook(() => useImageZoom(buildParams()));

    expect(result.current.composedGesture).not.toBeNull();
    expect(result.current.composedGesture).toMatchObject({
      __kind: 'simultaneous',
    });
  });

  it('resetTransformImmediate runs without throwing', () => {
    const { result } = renderHook(() => useImageZoom(buildParams()));

    expect(() => {
      act(() => {
        result.current.resetTransformImmediate();
      });
    }).not.toThrow();
  });

  it('resetTransform runs without throwing', () => {
    const { result } = renderHook(() => useImageZoom(buildParams()));

    expect(() => {
      act(() => {
        result.current.resetTransform();
      });
    }).not.toThrow();
  });

  // Smoke test for the gesture handler wiring: full gesture-handler
  // integration would require building a real GestureDetector runtime, which
  // is out of scope here. Instead, verify that each captured handler can be
  // driven with a synthetic event without throwing — this catches obvious
  // regressions like missing null-guards on `event.translationX` etc.
  it('gesture handlers do not throw when invoked with synthetic events', () => {
    const factory = makeMockGestureFactory();
    renderHook(() =>
      useImageZoom(buildParams({ gestureRuntime: { Gesture: factory } }))
    );

    const builders = (
      factory as unknown as { __builders: MockGestureBuilder[] }
    ).__builders;
    expect(builders.length).toBeGreaterThan(0);

    const syntheticEvent = {
      scale: 1.5,
      focalX: 100,
      focalY: 120,
      translationX: 40,
      translationY: 25,
      velocityX: 0,
      x: 80,
      y: 90,
    };

    expect(() => {
      for (const builder of builders) {
        builder.__handlers.start?.();
        builder.__handlers.update?.(syntheticEvent);
        builder.__handlers.end?.(syntheticEvent);
      }
    }).not.toThrow();
  });
});

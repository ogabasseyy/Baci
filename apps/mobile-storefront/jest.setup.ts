import '@testing-library/jest-native/extend-expect';

import { configure as configureReactNativeTestingLibrary } from '@testing-library/react-native';
import React, { type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

// The suite runs single-process (`jest --runInBand`, 560+ files). Late files
// execute under accumulated memory/GC pressure that can stall a resolved-promise
// microtask past React Native Testing Library's 1s default `asyncUtilTimeout`,
// intermittently timing out `waitFor` assertions (e.g. use-checkout-savings)
// with no real failure. Widen the async window so load — not correctness —
// never decides the result.
configureReactNativeTestingLibrary({ asyncUtilTimeout: 5000 });

// Resolve Expo's lazy fetch polyfill before test teardown can invalidate native mocks.
void globalThis.fetch;

function mockKeyboardProvider({
  children,
  ...props
}: {
  children?: ReactNode;
  [key: string]: unknown;
}) {
  return React.createElement(
    View,
    { testID: 'keyboard-provider', ...props },
    children
  );
}

function mockKeyboardAwareScrollView({
  children,
  ...props
}: {
  children?: ReactNode;
  [key: string]: unknown;
}) {
  return React.createElement(
    ScrollView,
    { testID: 'keyboard-aware-scroll-view', ...props },
    children
  );
}

function mockKeyboardAvoidingView({
  children,
  ...props
}: {
  children?: ReactNode;
  [key: string]: unknown;
}) {
  return React.createElement(
    View,
    { testID: 'keyboard-container', ...props },
    children
  );
}

mockKeyboardProvider.displayName = 'MockKeyboardProvider';
mockKeyboardAwareScrollView.displayName = 'MockKeyboardAwareScrollView';
mockKeyboardAvoidingView.displayName = 'MockKeyboardAvoidingView';

jest.mock('react-native-keyboard-controller', () => ({
  KeyboardAwareScrollView: mockKeyboardAwareScrollView,
  KeyboardAvoidingView: mockKeyboardAvoidingView,
  KeyboardProvider: mockKeyboardProvider,
}));

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('./__mocks__/async-storage')
);

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: {
    Success: 'success',
    Warning: 'warning',
    Error: 'error',
  },
}));

// Mock expo-router
jest.mock('expo-router', () => ({
  usePathname: jest.fn(() => '/'),
  useIsFocused: jest.fn(() => false),
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  })),
  Link: 'Link',
}));

// Mock vector icons
jest.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: 'Ionicons',
  __esModule: true,
  default: 'Ionicons',
}));

jest.mock('@react-native-vector-icons/fontawesome', () => ({
  FontAwesome: 'FontAwesome',
  __esModule: true,
  default: 'FontAwesome',
}));

jest.mock('@react-native-vector-icons/feather', () => ({
  Feather: 'Feather',
  __esModule: true,
  default: 'Feather',
}));

jest.mock('react-native-worklets', () =>
  require('react-native-worklets/lib/module/mock')
);

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { FlatList, Image, ScrollView, Text, View } = require('react-native');

  type MockComponentProps = Record<string, unknown> & {
    children?: unknown;
    style?: unknown;
  };

  const MockAnimatedView = ({
    children,
    style,
    ...props
  }: MockComponentProps) =>
    React.createElement(View, { style, ...props }, children);
  const MockAnimatedText = ({
    children,
    style,
    ...props
  }: MockComponentProps) =>
    React.createElement(Text, { style, ...props }, children);
  const MockAnimatedScrollView = ({
    children,
    style,
    ...props
  }: MockComponentProps) =>
    React.createElement(ScrollView, { style, ...props }, children);
  const MockAnimatedFlatList = ({
    children,
    style,
    ...props
  }: MockComponentProps) =>
    React.createElement(FlatList, { style, ...props }, children);
  const MockAnimatedImage = ({
    children,
    style,
    ...props
  }: MockComponentProps) =>
    React.createElement(Image, { style, ...props }, children);
  const identityAnimation = (toValue: unknown) => toValue;
  const animationWithCallback = (
    toValue: unknown,
    _config?: unknown,
    callback?: (finished: boolean) => void
  ) => {
    if (typeof callback === 'function') {
      setTimeout(() => callback(true), 0);
    }
    return toValue;
  };
  const createAnimationBuilder = () => {
    const builder: Record<string, (...args: unknown[]) => unknown> = {};
    const chain = () => builder;

    builder.delay = jest.fn(chain);
    builder.duration = jest.fn(chain);
    builder.easing = jest.fn(chain);
    builder.springify = jest.fn(chain);
    builder.damping = jest.fn(chain);
    builder.stiffness = jest.fn(chain);
    builder.mass = jest.fn(chain);
    builder.withCallback = jest.fn(chain);
    builder.withInitialValues = jest.fn(chain);
    builder.build = jest.fn(() => ({}));

    return builder;
  };
  const interpolate = (
    value: number,
    inputRange: number[],
    outputRange: number[]
  ) => {
    if (value <= inputRange[0]) return outputRange[0];
    const lastIndex = inputRange.length - 1;
    if (value >= inputRange[lastIndex]) return outputRange[lastIndex];

    const nextIndex = inputRange.findIndex((input) => value <= input);
    const previousIndex = Math.max(0, nextIndex - 1);
    const inputSpan = inputRange[nextIndex] - inputRange[previousIndex];
    const outputSpan = outputRange[nextIndex] - outputRange[previousIndex];
    const progress =
      inputSpan === 0 ? 0 : (value - inputRange[previousIndex]) / inputSpan;

    return outputRange[previousIndex] + outputSpan * progress;
  };
  const mock = {
    useSharedValue: (initVal: unknown) => {
      const sharedValueRef = React.useRef(null) as {
        current: {
          value: unknown;
          get: () => unknown;
          set: (nextValue: unknown) => void;
        } | null;
      };

      if (!sharedValueRef.current) {
        let currentValue = initVal;
        sharedValueRef.current = {
          get value() {
            return currentValue;
          },
          set value(nextValue: unknown) {
            currentValue = nextValue;
          },
          get: () => currentValue,
          set: (nextValue: unknown) => {
            currentValue = nextValue;
          },
        };
      }

      return sharedValueRef.current;
    },
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useEvent: (handler: (...args: unknown[]) => unknown) => handler,
    useAnimatedRef: () => ({ current: null }),
    useAnimatedScrollHandler: (handler: unknown) => {
      if (
        handler &&
        typeof handler === 'object' &&
        'onScroll' in handler &&
        typeof handler.onScroll === 'function'
      ) {
        const onScroll = handler.onScroll as (...args: unknown[]) => unknown;
        return (payload: { nativeEvent?: unknown }) =>
          onScroll(payload?.nativeEvent ?? payload);
      }

      return handler;
    },
    useAnimatedProps: (fn: () => unknown) => fn(),
    withSpring: animationWithCallback,
    withTiming: animationWithCallback,
    withDelay: (_delayMs: number, animation: unknown) => animation,
    withRepeat: (anim: unknown) => anim,
    withSequence: (...anims: unknown[]) => anims[0],
    withDecay: identityAnimation,
    cancelAnimation: jest.fn(),
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
    runOnUI: (fn: (...args: unknown[]) => unknown) => fn,
    scrollTo: jest.fn(),
    measure: jest.fn(() => null),
    interpolate,
    interpolateColor: (
      value: number,
      inputRange: number[],
      outputRange: string[]
    ) =>
      outputRange[inputRange.findIndex((input) => value <= input)] ??
      outputRange[0],
    Extrapolate: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
    Extrapolation: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
    Easing: {
      back: jest.fn(() => (value: number) => value),
      bezier: jest.fn(() => (value: number) => value),
      bounce: jest.fn((value: number) => value),
      circle: jest.fn((value: number) => value),
      cubic: jest.fn((value: number) => value),
      ease: jest.fn((value: number) => value),
      elastic: jest.fn(() => (value: number) => value),
      exp: jest.fn((value: number) => value),
      in: jest.fn((fn: (value: number) => number) => fn),
      inOut: jest.fn((fn: (value: number) => number) => fn),
      linear: jest.fn((value: number) => value),
      out: jest.fn((fn: (value: number) => number) => fn),
      poly: jest.fn(() => (value: number) => value),
      quad: jest.fn((value: number) => value),
      sin: jest.fn((value: number) => value),
      steps: jest.fn(() => (value: number) => value),
    },
    View: MockAnimatedView,
    Text: MockAnimatedText,
    ScrollView: MockAnimatedScrollView,
    FlatList: MockAnimatedFlatList,
    Image: MockAnimatedImage,
    createAnimatedComponent: (component: unknown) => component,
    FadeIn: createAnimationBuilder(),
    FadeInDown: createAnimationBuilder(),
    FadeInLeft: createAnimationBuilder(),
    FadeInRight: createAnimationBuilder(),
    FadeInUp: createAnimationBuilder(),
    FadeOut: createAnimationBuilder(),
    FadeOutDown: createAnimationBuilder(),
    FadeOutLeft: createAnimationBuilder(),
    FadeOutRight: createAnimationBuilder(),
    FadeOutUp: createAnimationBuilder(),
    SlideInDown: createAnimationBuilder(),
    SlideInLeft: createAnimationBuilder(),
    SlideInRight: createAnimationBuilder(),
    SlideInUp: createAnimationBuilder(),
    SlideOutDown: createAnimationBuilder(),
    SlideOutLeft: createAnimationBuilder(),
    SlideOutRight: createAnimationBuilder(),
    SlideOutUp: createAnimationBuilder(),
    ZoomIn: createAnimationBuilder(),
    ZoomOut: createAnimationBuilder(),
    Layout: createAnimationBuilder(),
    LinearTransition: createAnimationBuilder(),
    Keyframe: class MockKeyframe {
      duration() {
        return this;
      }
      delay() {
        return this;
      }
    },
    __esModule: true,
  };

  Object.defineProperty(mock, 'default', {
    enumerable: true,
    value: mock,
  });

  return mock;
});

// Mock react-native-gesture-handler
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const { Pressable, View } = require('react-native');

  const createGesture = (): Record<string, (...args: unknown[]) => unknown> => {
    const gesture: Record<string, (...args: unknown[]) => unknown> = {};
    const chain = () => gesture;

    gesture.activeOffsetX = jest.fn(chain);
    gesture.maxDistance = jest.fn(chain);
    gesture.maxPointers = jest.fn(chain);
    gesture.minDistance = jest.fn(chain);
    gesture.minPointers = jest.fn(chain);
    gesture.numberOfTaps = jest.fn(chain);
    gesture.onEnd = jest.fn(chain);
    gesture.onFinalize = jest.fn(chain);
    gesture.onStart = jest.fn(chain);
    gesture.onUpdate = jest.fn(chain);

    return gesture;
  };

  const createHookGesture = (type: string, config: unknown) => ({
    config,
    type,
  });

  return {
    Touchable: ({
      children,
      ...props
    }: React.ComponentProps<typeof Pressable>) =>
      React.createElement(Pressable, props, children),
    GestureDetector: ({ children }: { children?: React.ReactNode }) => children,
    GestureHandlerRootView: ({
      children,
      style,
    }: {
      children?: React.ReactNode;
      style?: import('react-native').StyleProp<
        import('react-native').ViewStyle
      >;
    }) => React.createElement(View, { style }, children),
    Gesture: {
      Pan: jest.fn(createGesture),
      Pinch: jest.fn(createGesture),
      Race: jest.fn((...gestures: unknown[]) => ({
        gestures,
        type: 'race',
      })),
      Simultaneous: jest.fn((...gestures: unknown[]) => ({
        gestures,
        type: 'simultaneous',
      })),
      Tap: jest.fn(createGesture),
    },
    usePanGesture: jest.fn((config: unknown) =>
      createHookGesture('pan', config)
    ),
    useSimultaneousGestures: jest.fn((...gestures: unknown[]) => ({
      gestures,
      type: 'simultaneous',
    })),
    useTapGesture: jest.fn((config: unknown) =>
      createHookGesture('tap', config)
    ),
  };
});

// Mock react-native-mmkv
jest.mock('react-native-mmkv', () => {
  return {
    createMMKV: jest.fn().mockImplementation(() => {
      const store = new Map<string, string>();
      return {
        set: jest.fn((key: string, value: string) => {
          store.set(key, value);
        }),
        getString: jest.fn((key: string) => {
          return store.get(key) ?? null;
        }),
        getNumber: jest.fn((key: string) => {
          const val = store.get(key);
          return val ? Number(val) : null;
        }),
        getBoolean: jest.fn((key: string) => {
          const val = store.get(key);
          return val === 'true';
        }),
        remove: jest.fn((key: string) => {
          store.delete(key);
        }),
        clearAll: jest.fn(() => {
          store.clear();
        }),
        getAllKeys: jest.fn(() => {
          return Array.from(store.keys());
        }),
      };
    }),
  };
});

// react-native-webview pulls in a native TurboModule (NativeRNCWebViewModule)
// that isn't available under jest. The receipt preview renders an HTML receipt
// in a WebView, so mock it as a plain View for the test environment.
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const WebView = (props: Record<string, unknown>) =>
    React.createElement(View, props);
  return { __esModule: true, default: WebView, WebView };
});

// `useSafeAreaInsets` throws without a `SafeAreaProvider` ancestor, but most
// suites render screens in isolation. Default the insets to zero globally;
// suites needing nonzero insets still override with a per-file `jest.mock`.
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
  };
});

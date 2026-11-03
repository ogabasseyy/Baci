import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useWarmTabScreens } from './useWarmTabScreens';

type TabRoute = BottomTabBarProps['state']['routes'][number];

function createRoute(name: string): TabRoute {
  return {
    key: `${name}-key`,
    name,
    params: {},
  };
}

function mockFrameScheduler() {
  const frameCallbacks: FrameRequestCallback[] = [];
  const requestFrameSpy = jest
    .spyOn(globalThis, 'requestAnimationFrame')
    .mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
  const cancelFrameSpy = jest
    .spyOn(globalThis, 'cancelAnimationFrame')
    .mockImplementation(() => undefined);

  return { cancelFrameSpy, frameCallbacks, requestFrameSpy };
}

function flushFrames(frameCallbacks: FrameRequestCallback[]) {
  while (frameCallbacks.length > 0) {
    const callback = frameCallbacks.shift();
    callback?.(0);
  }
}

describe('useWarmTabScreens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not preload public tabs from the tab chrome', () => {
    const { frameCallbacks, requestFrameSpy, cancelFrameSpy } =
      mockFrameScheduler();
    const navigateToTab = jest.fn();

    renderHook(() =>
      useWarmTabScreens({
        activeRouteName: 'index',
        navigateToTab,
        preloadProtectedTabs: false,
        routes: [
          createRoute('index'),
          createRoute('saved'),
          createRoute('cart'),
          createRoute('wallet'),
        ],
      })
    );

    expect(navigateToTab).not.toHaveBeenCalled();

    flushFrames(frameCallbacks);
    jest.runOnlyPendingTimers();

    expect(navigateToTab).not.toHaveBeenCalled();

    requestFrameSpy.mockRestore();
    cancelFrameSpy.mockRestore();
  });

  it('does not preload protected tabs when preloadProtectedTabs is true', () => {
    const { frameCallbacks, requestFrameSpy, cancelFrameSpy } =
      mockFrameScheduler();
    const navigateToTab = jest.fn();

    renderHook(() =>
      useWarmTabScreens({
        activeRouteName: 'index',
        navigateToTab,
        preloadProtectedTabs: true,
        routes: [createRoute('index'), createRoute('wallet')],
      })
    );

    flushFrames(frameCallbacks);
    jest.runOnlyPendingTimers();

    expect(navigateToTab).not.toHaveBeenCalled();

    requestFrameSpy.mockRestore();
    cancelFrameSpy.mockRestore();
  });
});

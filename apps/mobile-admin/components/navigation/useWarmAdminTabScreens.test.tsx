import { render } from '@testing-library/react';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWarmAdminTabScreens } from './useWarmAdminTabScreens';

const mocks = vi.hoisted(() => ({ prefetch: vi.fn() }));
vi.mock('expo-router', () => ({ router: { prefetch: mocks.prefetch } }));
type TabRoute = BottomTabBarProps['state']['routes'][number];
const routes: TabRoute[] = [
  { key: 'index-key', name: 'index', params: {} },
  { key: 'orders-key', name: 'orders', params: { status: 'open' } },
  { key: 'products-key', name: 'products', params: {} },
];
function Harness({ activeRouteName }: { activeRouteName: string }) {
  useWarmAdminTabScreens({ activeRouteName, routes });
  return null;
}

describe('useWarmAdminTabScreens', () => {
  let frameCallbacks: FrameRequestCallback[];
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    frameCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const flush = () => {
    frameCallbacks.splice(0).forEach((callback) => {
      callback(0);
    });
    frameCallbacks.splice(0).forEach((callback) => {
      callback(16);
    });
    vi.runOnlyPendingTimers();
  };
  it('prefetches inactive admin tabs after the first paint settles', () => {
    render(<Harness activeRouteName="index" />);
    expect(mocks.prefetch).not.toHaveBeenCalled();
    flush();
    expect(mocks.prefetch).toHaveBeenCalledWith({
      pathname: '/(admin)/(tabs)/orders',
      params: { status: 'open' },
    });
    expect(mocks.prefetch).toHaveBeenCalledWith({
      pathname: '/(admin)/(tabs)/products',
      params: {},
    });
    expect(mocks.prefetch).toHaveBeenCalledTimes(2);
  });
  it('does not prefetch active or already warmed routes again', () => {
    const { rerender } = render(<Harness activeRouteName="index" />);
    flush();
    expect(mocks.prefetch).toHaveBeenCalledTimes(2);
    rerender(<Harness activeRouteName="orders" />);
    flush();
    expect(mocks.prefetch).toHaveBeenCalledTimes(3);
    expect(mocks.prefetch).toHaveBeenLastCalledWith({
      pathname: '/(admin)/(tabs)/index',
      params: {},
    });
  });
  it('does not prefetch after the tab bar unmounts', () => {
    const { unmount } = render(<Harness activeRouteName="index" />);
    unmount();
    flush();
    expect(mocks.prefetch).not.toHaveBeenCalled();
  });
  it('retries a synchronous prefetch failure and continues with other tabs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.prefetch.mockImplementationOnce(() => {
      throw new Error('unavailable');
    });
    const { rerender } = render(<Harness activeRouteName="index" />);
    flush();
    expect(mocks.prefetch).toHaveBeenCalledTimes(2);
    rerender(<Harness activeRouteName="products" />);
    flush();
    expect(mocks.prefetch).toHaveBeenCalledWith({
      pathname: '/(admin)/(tabs)/orders',
      params: { status: 'open' },
    });
    expect(mocks.prefetch).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });
});

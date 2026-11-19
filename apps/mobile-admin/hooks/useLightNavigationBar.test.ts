// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setStyle: vi.fn(),
  isRuntimePlatform: vi.fn(),
}));

vi.mock('expo-navigation-bar', () => ({ setStyle: mocks.setStyle }));
vi.mock('@/config/runtime-platform', () => ({
  isRuntimePlatform: mocks.isRuntimePlatform,
}));

import { useLightNavigationBar } from './useLightNavigationBar';

// Cleared BEFORE each test, not after: React Testing Library's auto-cleanup
// unmounts any still-mounted hook between tests, and that unmount runs the
// effect's teardown — which calls setStyle. Clearing up front makes each test
// independent of that ordering.
beforeEach(() => {
  vi.clearAllMocks();
});

describe('useLightNavigationBar', () => {
  it('forces light navigation-bar icons while mounted on Android', () => {
    // Arrange
    mocks.isRuntimePlatform.mockReturnValue(true);

    // Act
    renderHook(() => useLightNavigationBar(true));

    // Assert
    expect(mocks.setStyle).toHaveBeenCalledWith('light');
  });

  it('restores the dark-theme style for a light system theme on unmount', () => {
    // Arrange
    mocks.isRuntimePlatform.mockReturnValue(true);
    const { unmount } = renderHook(() => useLightNavigationBar(false));
    mocks.setStyle.mockClear();

    // Act
    unmount();

    // Assert — isDark false means the app is in light theme, which wants dark
    // icons back.
    expect(mocks.setStyle).toHaveBeenCalledWith('dark');
  });

  it('restores light icons on unmount when the app theme is dark', () => {
    // Arrange
    mocks.isRuntimePlatform.mockReturnValue(true);
    const { unmount } = renderHook(() => useLightNavigationBar(true));
    mocks.setStyle.mockClear();

    // Act
    unmount();

    // Assert
    expect(mocks.setStyle).toHaveBeenCalledWith('light');
  });

  it('re-forces light icons when isDark flips while mounted', () => {
    // Arrange
    mocks.isRuntimePlatform.mockReturnValue(true);
    const { rerender } = renderHook(
      ({ isDark }) => useLightNavigationBar(isDark),
      { initialProps: { isDark: false } }
    );
    mocks.setStyle.mockClear();

    // Act — exercises the [isDark] dependency: cleanup runs, then the effect.
    rerender({ isDark: true });

    // Assert
    expect(mocks.setStyle).toHaveBeenLastCalledWith('light');
  });

  it('does nothing off Android', () => {
    // Arrange
    mocks.isRuntimePlatform.mockReturnValue(false);

    // Act
    const { unmount } = renderHook(() => useLightNavigationBar(true));
    unmount();

    // Assert
    expect(mocks.setStyle).not.toHaveBeenCalled();
  });
});

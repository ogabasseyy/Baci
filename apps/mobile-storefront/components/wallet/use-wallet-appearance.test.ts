import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { SPACING } from '@/constants/Colors';
import {
  CHAT_WIDGET_DEFAULT_BOTTOM_OFFSET,
  CHAT_WIDGET_FAB_SIZE,
  getHomeContentBottomPadding,
} from '@/constants/layout';
import { useStorefrontInsets } from '@/hooks/use-storefront-insets';
import { useWalletAppearance } from './use-wallet-appearance';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: jest.fn(),
}));

jest.mock('@/hooks/use-storefront-insets', () => ({
  useStorefrontInsets: jest.fn(),
}));

describe('useWalletAppearance', () => {
  it('preserves dark colors and tab scroll inset options', () => {
    const scrollContentStyle = { paddingBottom: 99, paddingTop: 17 };
    jest.mocked(useColorScheme).mockReturnValue('dark');
    const getScrollContentStyle = jest.fn(() => scrollContentStyle);
    jest.mocked(useStorefrontInsets).mockReturnValue({
      getListContentStyle:
        jest.fn<
          ReturnType<typeof useStorefrontInsets>['getListContentStyle']
        >(),
      getScrollContentStyle,
      insets: { top: 0, right: 0, bottom: 34, left: 0 },
    });

    const { result } = renderHook(() => useWalletAppearance('tab'));

    expect(result.current.colors).toBe(Colors.dark);
    expect(result.current.scrollContentStyle).toBe(scrollContentStyle);
    expect(getScrollContentStyle).toHaveBeenCalledWith({
      includeBottomInset: false,
      paddingBottom: getHomeContentBottomPadding(34, true),
    });
  });

  it('bugfix: clears the floating tab bar, the chat button and the home indicator as a tab', () => {
    const getScrollContentStyle = jest.fn(() => ({}));
    jest.mocked(useColorScheme).mockReturnValue('light');
    jest.mocked(useStorefrontInsets).mockReturnValue({
      getListContentStyle:
        jest.fn<
          ReturnType<typeof useStorefrontInsets>['getListContentStyle']
        >(),
      getScrollContentStyle,
      insets: { top: 0, right: 0, bottom: 34, left: 0 },
    });

    renderHook(() => useWalletAppearance('tab'));

    const [options] = getScrollContentStyle.mock.calls[0] as unknown as [
      { paddingBottom: number },
    ];
    // Floating bar: 64 tall, 24 up, plus the 34 home indicator = 122; the
    // old 100 + 34 = 134 left the last rows under the chat button above it.
    expect(options.paddingBottom).toBeGreaterThan(64 + 24 + 34);
    expect(options.paddingBottom).toBe(getHomeContentBottomPadding(34, true));
  });

  it('preserves light colors and stack scroll padding', () => {
    const scrollContentStyle = { paddingBottom: 99, paddingTop: 17 };
    jest.mocked(useColorScheme).mockReturnValue('light');
    const getScrollContentStyle = jest.fn(() => scrollContentStyle);
    jest.mocked(useStorefrontInsets).mockReturnValue({
      getListContentStyle:
        jest.fn<
          ReturnType<typeof useStorefrontInsets>['getListContentStyle']
        >(),
      getScrollContentStyle,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    const { result } = renderHook(() => useWalletAppearance('stack'));

    expect(result.current.colors).toBe(Colors.light);
    expect(result.current.scrollContentStyle).toBe(scrollContentStyle);
    // Walk 18: the chat button also floats over pushed wallet screens, so the
    // card's buttons must be able to scroll clear of it.
    expect(getScrollContentStyle).toHaveBeenCalledWith({
      includeBottomInset: false,
      paddingBottom: Math.max(
        SPACING.xl,
        CHAT_WIDGET_DEFAULT_BOTTOM_OFFSET + CHAT_WIDGET_FAB_SIZE + SPACING.sm
      ),
    });
  });
});

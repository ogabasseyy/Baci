import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { SPACING } from '@/constants/Colors';
import { useStorefrontInsets } from '@/hooks/use-storefront-insets';
import { useWalletAppearance } from './use-wallet-appearance';
import { WALLET_TAB_SCROLL_PADDING_BOTTOM } from './wallet-tab.constants';

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
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    const { result } = renderHook(() => useWalletAppearance('tab'));

    expect(result.current.colors).toBe(Colors.dark);
    expect(result.current.scrollContentStyle).toBe(scrollContentStyle);
    expect(getScrollContentStyle).toHaveBeenCalledWith({
      includeBottomInset: true,
      paddingBottom: WALLET_TAB_SCROLL_PADDING_BOTTOM,
    });
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
    expect(getScrollContentStyle).toHaveBeenCalledWith({
      includeBottomInset: false,
      paddingBottom: SPACING.xl,
    });
  });
});

import { renderHook } from '@testing-library/react-native';
import { getHomeContentBottomPadding } from '@/constants/layout';
import { useStorefrontInsets } from '@/hooks/use-storefront-insets';
import { useWalletAppearance } from './use-wallet-appearance';

jest.mock('@/hooks/use-storefront-insets', () => ({
  useStorefrontInsets: jest.fn(),
}));

// Layout only: no server call, so it is the same whether PiggyVest is on or off.
it('keeps the wallet tab clear of the floating tab bar with PiggyVest off', () => {
  const getScrollContentStyle = jest.fn(() => ({}));
  jest.mocked(useStorefrontInsets).mockReturnValue({
    getListContentStyle: jest.fn(),
    getScrollContentStyle,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  } as unknown as ReturnType<typeof useStorefrontInsets>);
  renderHook(() => useWalletAppearance('tab'));
  expect(getScrollContentStyle).toHaveBeenCalledWith({
    includeBottomInset: false,
    paddingBottom: getHomeContentBottomPadding(0, true),
  });
});

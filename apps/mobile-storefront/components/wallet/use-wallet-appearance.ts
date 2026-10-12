import { useColorScheme } from '@/components/useColorScheme';
import Colors, { SPACING } from '@/constants/Colors';
import { useStorefrontInsets } from '@/hooks/use-storefront-insets';
import type { WalletScreenPresentation } from './wallet-screen.types';
import { WALLET_TAB_SCROLL_PADDING_BOTTOM } from './wallet-tab.constants';

export function useWalletAppearance(presentation: WalletScreenPresentation) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { getScrollContentStyle } = useStorefrontInsets();
  const scrollContentStyle = getScrollContentStyle({
    includeBottomInset: presentation === 'tab',
    paddingBottom:
      presentation === 'tab' ? WALLET_TAB_SCROLL_PADDING_BOTTOM : SPACING.xl,
  });

  return { colors, scrollContentStyle };
}

import { useColorScheme } from '@/components/useColorScheme';
import Colors, { SPACING } from '@/constants/Colors';
import { getHomeContentBottomPadding } from '@/constants/layout';
import { useStorefrontInsets } from '@/hooks/use-storefront-insets';
import { CONFIG } from '@/lib/config';
import { getTemplateConfig } from '@/lib/templates';
import type { WalletScreenPresentation } from './wallet-screen.types';

export function useWalletAppearance(presentation: WalletScreenPresentation) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { getScrollContentStyle, insets } = useStorefrontInsets();
  // As a tab, the last rows must scroll clear of the floating tab bar and the
  // chat button above it: the same clearance the home tab uses (it already
  // includes the bottom safe area).
  const template = getTemplateConfig(CONFIG.BUSINESS_TYPE, CONFIG.TEMPLATE_ID);
  const scrollContentStyle = getScrollContentStyle({
    includeBottomInset: false,
    paddingBottom:
      presentation === 'tab'
        ? getHomeContentBottomPadding(
            insets.bottom,
            template.features?.chatWidget ?? true
          )
        : SPACING.xl,
  });

  return { colors, scrollContentStyle };
}

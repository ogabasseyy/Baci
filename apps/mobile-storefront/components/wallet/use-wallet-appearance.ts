import { useColorScheme } from '@/components/useColorScheme';
import Colors, { SPACING } from '@/constants/Colors';
import {
  CHAT_WIDGET_DEFAULT_BOTTOM_OFFSET,
  CHAT_WIDGET_FAB_SIZE,
  CONTENT_OVERLAY_GAP,
  getChatWidgetBottomOffset,
  getHomeContentBottomPadding,
} from '@/constants/layout';
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
        : // The chat button floats over pushed screens too (raised by the
          // bottom safe area): keep the savings card's buttons able to
          // scroll clear of it.
          Math.max(
            SPACING.xl,
            template.features?.chatWidget === false
              ? 0
              : getChatWidgetBottomOffset(
                  CHAT_WIDGET_DEFAULT_BOTTOM_OFFSET,
                  insets.bottom
                ) +
                  CHAT_WIDGET_FAB_SIZE +
                  CONTENT_OVERLAY_GAP
          ),
  });

  return { colors, scrollContentStyle };
}

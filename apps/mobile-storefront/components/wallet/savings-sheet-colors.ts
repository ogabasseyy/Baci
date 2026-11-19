import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';

type WalletColors = (typeof Colors)['light'];

/**
 * The savings sheet's red brand accent over the app theme. The dark theme's
 * own primary is amber, so every savings surface (the sheet and the PIN and
 * "Confirm it's you" steps inside it) uses this one override.
 */
export function withSavingsBrand(colors: WalletColors): WalletColors {
  return {
    ...colors,
    primary: BRAND.primary,
    primaryForeground: BRAND.onPrimary,
    primaryLowOpacity: BRAND.primaryAlpha12,
  };
}

import { Stack } from 'expo-router';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import type Colors from '@/constants/Colors';
import { leaveStackedWallet } from '@/lib/leave-stacked-wallet';
import { WalletContent, type WalletContentProps } from './WalletContent';
import { WalletLoadingState } from './WalletLoadingState';
import { WalletScreenHeader } from './WalletScreenHeader';
import { styles } from './wallet.styles';

type WalletColors = (typeof Colors)['light'];

interface WalletScreenViewProps {
  colors: WalletColors;
  loadingMessage?: string;
  /** Retries a hung or failed wallet load (shown after a timeout). */
  onRetry?: () => unknown;
  presentation: 'stack' | 'tab';
  walletContentProps?: Omit<WalletContentProps, 'colors'>;
}

export function WalletScreenView({
  colors,
  loadingMessage,
  onRetry,
  presentation,
  walletContentProps,
}: WalletScreenViewProps) {
  // One title whether loading or loaded, matching the tab (walk-through).
  const title = 'Wallet & Loyalty';

  return (
    <>
      {presentation === 'stack' ? (
        // The page draws the same header as the tab, plus a back button
        // that falls back to the Wallet tab when there is no history.
        <Stack.Screen options={{ headerShown: false, title }} />
      ) : null}
      <StorefrontScreenShell
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={presentation === 'tab' ? ['top'] : ['top', 'bottom']}
      >
        {presentation === 'tab' ? (
          <WalletScreenHeader colors={colors} title="Wallet & Loyalty" />
        ) : (
          <WalletScreenHeader
            colors={colors}
            onBack={leaveStackedWallet}
            title={title}
          />
        )}
        {walletContentProps ? (
          <WalletContent colors={colors} {...walletContentProps} />
        ) : (
          <WalletLoadingState
            colors={colors}
            message={loadingMessage}
            onRetry={onRetry}
          />
        )}
      </StorefrontScreenShell>
    </>
  );
}

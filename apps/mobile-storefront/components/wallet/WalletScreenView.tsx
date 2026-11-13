import { Stack } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import { leaveStackedWallet } from '@/lib/leave-stacked-wallet';
import { WalletContent, type WalletContentProps } from './WalletContent';
import { WalletScreenHeader } from './WalletScreenHeader';
import { styles } from './wallet.styles';

type WalletColors = (typeof Colors)['light'];

interface WalletScreenViewProps {
  colors: WalletColors;
  loadingMessage?: string;
  presentation: 'stack' | 'tab';
  walletContentProps?: Omit<WalletContentProps, 'colors'>;
}

export function WalletScreenView({
  colors,
  loadingMessage,
  presentation,
  walletContentProps,
}: WalletScreenViewProps) {
  const hasWalletContent = Boolean(walletContentProps);
  const title = hasWalletContent ? 'Wallet & Loyalty' : 'Wallet';

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
          <View style={[styles.container, styles.centered]}>
            <ActivityIndicator
              testID="wallet-activity-indicator"
              accessibilityLabel="Preparing wallet"
              size="large"
              color={BRAND.primary}
            />
            {loadingMessage ? (
              <Text
                style={[styles.emptyTitle, { color: colors.textSecondary }]}
              >
                {loadingMessage}
              </Text>
            ) : null}
          </View>
        )}
      </StorefrontScreenShell>
    </>
  );
}

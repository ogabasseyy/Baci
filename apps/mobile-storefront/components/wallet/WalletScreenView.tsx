import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import type { WalletData } from '@/hooks/wallet-query';
import { WalletBalancePreview } from './WalletBalancePreview';
import { WalletContent, type WalletContentProps } from './WalletContent';
import { WalletPrimaryAccountContent } from './WalletPrimaryAccountContent';
import { styles } from './wallet.styles';

type WalletColors = (typeof Colors)['light'];

interface WalletScreenViewProps {
  colors: WalletColors;
  loadingMessage?: string;
  presentation: 'stack' | 'tab';
  walletContentProps?: Omit<WalletContentProps, 'colors'>;
  balancePreview?: WalletData;
  isError?: boolean;
  onRetry?: () => void;
}

export function WalletScreenView({
  colors,
  loadingMessage,
  presentation,
  walletContentProps,
  balancePreview,
  isError,
  onRetry,
}: WalletScreenViewProps) {
  const hasWalletContent = Boolean(walletContentProps);

  return (
    <>
      {presentation === 'stack' ? (
        <Stack.Screen
          options={{ title: hasWalletContent ? 'Wallet & Loyalty' : 'Wallet' }}
        />
      ) : null}
      <StorefrontScreenShell
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={presentation === 'tab' ? ['top'] : ['bottom']}
      >
        {presentation === 'tab' ? (
          <View style={styles.tabHeader}>
            <Ionicons
              name="wallet-outline"
              size={24}
              color={colors.text}
              accessible={false}
              importantForAccessibility="no"
            />
            <Text style={[styles.tabHeaderTitle, { color: colors.text }]}>
              Wallet & Loyalty
            </Text>
          </View>
        ) : null}
        {walletContentProps ? (
          <WalletPrimaryAccountContent
            colors={colors}
            {...walletContentProps}
          />
        ) : balancePreview ? (
          <WalletBalancePreview
            wallet={balancePreview}
            colors={colors}
            isError={isError}
            onRetry={onRetry}
          />
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

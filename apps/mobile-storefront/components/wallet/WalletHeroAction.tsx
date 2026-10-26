import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text } from 'react-native';
import { BRAND } from '@/constants/Colors';
import type { usePiggyvestWalletSetup } from '@/hooks/use-piggyvest-wallet-setup';
import { WALLET_COLORS } from './wallet.colors';
import { styles } from './wallet.styles';

type Props = {
  hasAccount: boolean;
  setupState?: ReturnType<typeof usePiggyvestWalletSetup>['state'];
  onPress: () => void;
  disabled?: boolean;
};

export function WalletHeroAction({
  hasAccount,
  setupState,
  onPress,
  disabled = false,
}: Props) {
  if (!hasAccount && !setupState) return null;
  const label = disabled
    ? 'Checking availability…'
    : hasAccount
      ? 'Add Money'
      : setupState === 'processing'
        ? 'View progress'
        : setupState === 'unavailable'
          ? 'Complete setup'
          : setupState === 'checking'
            ? 'Check account'
            : 'Create account number';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={{ disabled, busy: disabled }}
      accessibilityLabel={hasAccount ? 'Add money' : label}
      accessibilityHint={
        hasAccount
          ? 'Opens wallet funding options'
          : 'Opens your wallet setup status'
      }
      hitSlop={6}
      style={[
        styles.addMoneyButton,
        { borderColor: BRAND.primary, borderWidth: 2 },
        !hasAccount && { maxWidth: '100%', flexShrink: 1, marginLeft: 0 },
      ]}
      onPress={onPress}
    >
      <Ionicons
        accessible={false}
        importantForAccessibility="no"
        name={hasAccount ? 'add-circle-outline' : 'wallet-outline'}
        size={14}
        color={WALLET_COLORS.white}
      />
      <Text
        style={[styles.addMoneyButtonText, { flexShrink: 1 }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {label}
      </Text>
    </Pressable>
  );
}

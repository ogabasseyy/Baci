import Ionicons from '@react-native-vector-icons/ionicons';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WALLET_HERO_ACTION_LINE } from '@/constants/wallet-hero';

type Props = {
  canCreate: boolean;
  isCreating: boolean;
  needsPhone: boolean;
  onCreate: () => void;
  onOpenFundPanel: () => void;
};

export function WalletHeroCreateAccount({
  canCreate,
  isCreating,
  needsPhone,
  onCreate,
  onOpenFundPanel,
}: Props) {
  const disabled = isCreating || (!canCreate && !needsPhone);

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create account number"
        accessibilityHint="Creates your wallet bank transfer account"
        accessibilityState={{ disabled, busy: isCreating }}
        disabled={disabled}
        onPress={needsPhone ? onOpenFundPanel : onCreate}
        style={[styles.button, disabled ? styles.disabled : null]}
      >
        {isCreating ? (
          <ActivityIndicator size="small" color="#F8B84C" />
        ) : (
          <Ionicons
            name="add-circle-outline"
            size={WALLET_HERO_ACTION_LINE}
            color="#F8B84C"
            style={styles.icon}
          />
        )}
        <Text style={styles.label}>Create account number</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minWidth: 0,
    borderLeftWidth: 1,
    borderLeftColor: '#393D43',
    paddingLeft: 12,
  },
  button: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // Icon and label share one line height so the text sits on the icon's
  // centre line instead of riding above it (owner, 2026-11-16).
  icon: {
    width: WALLET_HERO_ACTION_LINE,
    height: WALLET_HERO_ACTION_LINE,
    lineHeight: WALLET_HERO_ACTION_LINE,
  },
  label: {
    color: '#F8B84C',
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
    lineHeight: WALLET_HERO_ACTION_LINE,
  },
  disabled: { opacity: 0.55 },
});

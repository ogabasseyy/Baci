import Ionicons from '@react-native-vector-icons/ionicons';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

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
          <Ionicons name="add-circle-outline" size={18} color="#F8B84C" />
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
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: { color: '#F8B84C', fontSize: 12, fontWeight: '700', flexShrink: 1 },
  disabled: { opacity: 0.55 },
});

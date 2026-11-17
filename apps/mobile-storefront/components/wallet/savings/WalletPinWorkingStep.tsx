import { ActivityIndicator, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { walletPinSheetStyles as styles } from './WalletPinSheet.styles';
import { WalletPinSheetHeader } from './WalletPinSheetHeader';

type WalletColors = (typeof Colors)['light'];

/**
 * A PIN step that is waiting on the server (checking the PIN status, or a new
 * PIN saving and approving this request): title, what is happening and a
 * spinner. No number pad, so nothing looks like it wants another PIN.
 */
export function WalletPinWorkingStep({
  colors,
  title,
  message,
  embedded = false,
  onClose,
}: {
  colors: WalletColors;
  title: string;
  message: string;
  embedded?: boolean;
  /** Only while checking: a PIN being approved cannot be backed out of. */
  onClose?: () => void;
}) {
  return (
    <>
      <WalletPinSheetHeader
        colors={colors}
        title={title}
        closeLabel="Close"
        embedded={embedded}
        onClose={onClose}
      />
      <View accessibilityLiveRegion="polite" accessible>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {message}
        </Text>
      </View>
      <ActivityIndicator
        accessibilityLabel={message}
        color={colors.primary}
        testID="wallet-pin-working"
      />
    </>
  );
}

import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import type { WalletDisplayFundingAccount } from './wallet.types';

type Props = {
  account: WalletDisplayFundingAccount;
  /** PiggyVest card: a clear "Copied" with a check icon after a copy. */
  emphasizeCopied?: boolean;
  preview?: boolean;
  purpose?: 'wallet' | 'savings';
  sandbox?: boolean;
};

const COPIED = 'Copied';
const COPIED_FEEDBACK_MS = 2000;

export function WalletHeroFundingAccount({
  account,
  emphasizeCopied = false,
  preview = false,
  purpose = 'wallet',
  sandbox = false,
}: Props) {
  const { copyToClipboard, feedback } = useCopyToClipboard(
    emphasizeCopied
      ? { successMessage: COPIED, timeoutMs: COPIED_FEEDBACK_MS }
      : undefined
  );
  const copied = emphasizeCopied && feedback === COPIED;
  const isSavingsAccount = purpose === 'savings' && !preview;

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          preview
            ? 'Preview account number, not for transfers'
            : isSavingsAccount
              ? 'Copy savings account number'
              : 'Copy funding account number'
        }
        accessibilityHint={
          preview
            ? undefined
            : isSavingsAccount
              ? sandbox
                ? 'Test savings account. Do not send real money.'
                : 'Transfers fund the savings plan'
              : 'Copies your account number'
        }
        accessibilityState={{ disabled: preview }}
        disabled={preview}
        onPress={() => copyToClipboard(account.accountNumber)}
        style={styles.account}
      >
        {preview ? (
          <Text style={styles.label}>DEMO · NOT FOR TRANSFERS</Text>
        ) : null}
        <View style={styles.numberRow}>
          <Text
            style={styles.number}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.65}
          >
            {account.accountNumber}
          </Text>
          {!preview ? (
            <Ionicons
              name={copied ? 'checkmark-circle' : 'copy-outline'}
              size={15}
              color="#F8B84C"
            />
          ) : null}
        </View>
        <Text style={styles.bank} numberOfLines={1}>
          {account.bankName}
        </Text>
      </Pressable>
      {feedback ? (
        <Text
          accessibilityLiveRegion="polite"
          style={copied ? styles.copied : styles.feedback}
        >
          {feedback}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
    borderLeftWidth: 1,
    borderLeftColor: '#393D43',
    paddingLeft: 12,
  },
  account: {
    width: '100%',
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  label: {
    color: '#F8B84C',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  number: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  bank: { color: '#AEB4BE', fontSize: 10, marginTop: 2 },
  feedback: { color: '#AEB4BE', fontSize: 9 },
  copied: { color: '#F8B84C', fontSize: 12, fontWeight: '700', marginTop: 2 },
});

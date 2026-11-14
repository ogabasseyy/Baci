import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { WalletProviderAttribution } from './WalletProviderAttribution';
import type { WalletDisplayFundingAccount } from './wallet.types';
import { styles } from './wallet-fund-panel.styles';

const COPIED = 'Copied';

/**
 * The transfer account in Add money. PiggyVest (the PiggyVest merchant
 * only): a copy shows in place, a tick and "Copied" where the bank name
 * sits, like the wallet card, so the sheet never grows or jumps; and the
 * provider's internal wallet label ("Default Wallet") is not shown. Every
 * other store keeps today's card and its feedback line under the footer.
 */
export function WalletFundAccountCard({
  colors,
  fundingAccount,
}: {
  colors: (typeof Colors)['light'];
  fundingAccount: WalletDisplayFundingAccount;
}) {
  const piggyvest = fundingAccount.provider === 'piggyvest';
  const { copyToClipboard, feedback } = useCopyToClipboard(
    piggyvest ? { successMessage: COPIED, timeoutMs: 2000 } : undefined
  );
  const copied = piggyvest && feedback === COPIED;
  return (
    <>
      <View
        style={[
          styles.accountCard,
          { backgroundColor: colors.muted, borderColor: colors.border },
        ]}
      >
        <View style={styles.accountCopy}>
          <Text
            accessibilityLiveRegion={copied ? 'polite' : undefined}
            style={[
              styles.accountBank,
              { color: copied ? colors.success : colors.textSecondary },
            ]}
          >
            {copied ? COPIED : fundingAccount.bankName}
          </Text>
          <Text style={[styles.accountNumber, { color: colors.text }]}>
            {fundingAccount.accountNumber}
          </Text>
          {piggyvest ? null : (
            <Text style={[styles.accountName, { color: colors.textSecondary }]}>
              {fundingAccount.accountName}
            </Text>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            piggyvest
              ? 'Copy savings account number'
              : 'Copy wallet account number'
          }
          accessibilityHint={
            piggyvest
              ? 'Transfers add to your savings wallet, not store credit'
              : 'Copies your account number'
          }
          style={[styles.accountCopyButton, { backgroundColor: colors.card }]}
          onPress={() => copyToClipboard(fundingAccount.accountNumber)}
        >
          <Ionicons
            name={copied ? 'checkmark-circle' : 'copy-outline'}
            size={18}
            color={copied ? colors.success : colors.primary}
          />
        </Pressable>
      </View>
      <WalletProviderAttribution
        provider={fundingAccount.provider}
        color={colors.textSecondary}
      />
      {feedback && !copied ? (
        <Text
          accessibilityRole="text"
          style={[styles.copyFeedback, { color: colors.textSecondary }]}
        >
          {feedback}
        </Text>
      ) : null}
    </>
  );
}

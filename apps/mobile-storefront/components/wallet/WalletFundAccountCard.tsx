import Ionicons from '@react-native-vector-icons/ionicons';
import Constants from 'expo-constants';
import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { formatFundingAccountName } from './format-funding-account-name';
import { WalletProviderAttribution } from './WalletProviderAttribution';
import type { WalletDisplayFundingAccount } from './wallet.types';
import { styles } from './wallet-fund-panel.styles';

const COPIED = 'Copied';
const SANDBOX_WALLET_LABEL = 'Default Wallet';

/**
 * The transfer account in Add money. PiggyVest (the PiggyVest merchant
 * only): a copy shows in place, a tick and "Copied" where the bank name
 * sits, like the wallet card, so the sheet never grows or jumps. The account
 * name shows under the number for every store (the sandbox's internal
 * "Default Wallet" label excepted); PiggyVest's reads customer first, then
 * the store's short name. Every other store keeps today's card and its
 * feedback line under the footer.
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
  // PiggyVest's sandbox labels every account "Default Wallet"; that internal
  // label is never a name to match against, so it stays hidden.
  const showAccountName =
    fundingAccount.accountName.trim() !== '' &&
    !(piggyvest && fundingAccount.accountName.trim() === SANDBOX_WALLET_LABEL);
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
          {showAccountName ? (
            // PiggyVest's "<business>/<customer>" reads customer first, then
            // the store's short name; two lines fit a long name.
            <Text
              numberOfLines={2}
              style={[styles.accountName, { color: colors.textSecondary }]}
            >
              {piggyvest
                ? formatFundingAccountName(
                    fundingAccount.accountName,
                    Constants.expoConfig?.name
                  )
                : fundingAccount.accountName}
            </Text>
          ) : null}
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

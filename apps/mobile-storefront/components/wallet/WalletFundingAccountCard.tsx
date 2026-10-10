import Ionicons from '@react-native-vector-icons/ionicons';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type Colors from '@/constants/Colors';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import type { WalletCreditWatch } from '@/hooks/use-wallet-credit-watch';
import { WalletCreditCheckPanel } from './WalletCreditCheckPanel';
import { WalletProviderAttribution } from './WalletProviderAttribution';
import type { WalletDisplayFundingAccount } from './wallet.types';

type WalletColors = (typeof Colors)['light'];

type WalletFundingAccountCardProps = {
  accentColor: string;
  canCreateFundingAccount: boolean;
  colors: WalletColors;
  createFundingAccountUnavailableMessage?: string;
  creditWatch?: WalletCreditWatch;
  fundingAccount: WalletDisplayFundingAccount | null;
  isCreatingFundingAccount: boolean;
  needsPhone: boolean;
  onCreateFundingAccount: () => void;
  onOpenFundPanel: () => void;
};

export function WalletFundingAccountCard({
  accentColor,
  canCreateFundingAccount,
  colors,
  createFundingAccountUnavailableMessage,
  creditWatch,
  fundingAccount,
  isCreatingFundingAccount,
  needsPhone,
  onCreateFundingAccount,
  onOpenFundPanel,
}: WalletFundingAccountCardProps) {
  const { copyToClipboard, feedback: copyFeedback } = useCopyToClipboard();
  const isCreateDisabled =
    isCreatingFundingAccount || (!canCreateFundingAccount && !needsPhone);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.heading, { color: colors.cardForeground }]}>
        {fundingAccount ? 'Your account number' : 'Add money by bank transfer'}
      </Text>
      {fundingAccount ? (
        <>
          <View style={styles.bankRow}>
            <Ionicons name="business-outline" size={22} color={accentColor} />
            <View style={styles.bankDetails}>
              <Text style={[styles.bankName, { color: colors.cardForeground }]}>
                {fundingAccount.bankName}
              </Text>
              <Text style={[styles.helper, { color: colors.textSecondary }]}>
                Deposit to your Ogabassey wallet
              </Text>
            </View>
          </View>
          <View
            style={[
              styles.numberRow,
              { backgroundColor: colors.muted, borderColor: colors.border },
            ]}
          >
            <Text
              style={[styles.accountNumber, { color: colors.cardForeground }]}
              selectable
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {fundingAccount.accountNumber}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy funding account number"
              accessibilityHint="Copies your account number"
              style={[styles.copyButton, { backgroundColor: colors.card }]}
              onPress={() => copyToClipboard(fundingAccount.accountNumber)}
            >
              <Ionicons
                name="copy-outline"
                size={20}
                color={colors.cardForeground}
              />
            </Pressable>
          </View>
          <Text
            style={[styles.accountNameLabel, { color: colors.textSecondary }]}
          >
            Account name
          </Text>
          <Text style={[styles.accountName, { color: colors.cardForeground }]}>
            {fundingAccount.accountName}
          </Text>
          <WalletProviderAttribution
            provider={fundingAccount.provider}
            color={colors.textSecondary}
          />
          {copyFeedback ? (
            <Text
              accessibilityRole="text"
              style={[styles.helper, { color: colors.textSecondary }]}
            >
              {copyFeedback}
            </Text>
          ) : null}
          {creditWatch ? (
            <WalletCreditCheckPanel
              accentColor={accentColor}
              textColor={colors.cardForeground}
              watch={creditWatch}
            />
          ) : null}
        </>
      ) : (
        <>
          <Text style={[styles.helper, { color: colors.textSecondary }]}>
            Create a dedicated account number to add money to your wallet.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create account number"
            accessibilityHint="Creates your wallet bank transfer account"
            accessibilityState={{ disabled: isCreateDisabled }}
            disabled={isCreateDisabled}
            style={[
              styles.createButton,
              { borderColor: colors.border },
              isCreateDisabled ? styles.disabled : null,
            ]}
            onPress={needsPhone ? onOpenFundPanel : onCreateFundingAccount}
          >
            {isCreatingFundingAccount ? (
              <ActivityIndicator size="small" color={accentColor} />
            ) : (
              <Text style={[styles.createText, { color: accentColor }]}>
                Create account number
              </Text>
            )}
          </Pressable>
          {createFundingAccountUnavailableMessage ? (
            <Text
              accessibilityRole="text"
              style={[styles.helper, { color: colors.textSecondary }]}
            >
              {createFundingAccountUnavailableMessage}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
    gap: 10,
  },
  heading: { fontSize: 18, fontWeight: '700' },
  bankRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bankDetails: { flex: 1 },
  bankName: { fontSize: 14, fontWeight: '700' },
  helper: { fontSize: 12, lineHeight: 17 },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingLeft: 14,
    paddingRight: 6,
    minHeight: 66,
  },
  accountNumber: { flex: 1, fontSize: 24, fontWeight: '700', letterSpacing: 1 },
  copyButton: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountNameLabel: { fontSize: 11, marginTop: 4 },
  accountName: { fontSize: 13, fontWeight: '600' },
  createButton: {
    borderWidth: 1,
    minHeight: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createText: { fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.55 },
});

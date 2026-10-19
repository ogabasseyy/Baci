import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import type { SavingsPlanFundingAccount } from '@/schemas/customer-savings';
import type { SavingsPlanFundingPhase } from './use-savings-plan-funding';

type FundingColors = (typeof Colors)['light'];

type SavingsPlanFundingDetailsProps = {
  account?: SavingsPlanFundingAccount;
  amount: number;
  copied: boolean;
  copyFailed?: boolean;
  error: string | null;
  goalTitle: string;
  isHostedStaging: boolean;
  onCopy: () => Promise<void>;
  onFetchExisting: () => void;
  onFetchWithIdentity: (bvn: string) => void;
  phase: SavingsPlanFundingPhase;
  requiresIdentity: boolean;
};

export function SavingsPlanFundingDetails({
  account,
  amount,
  copied,
  copyFailed = false,
  error,
  goalTitle,
  isHostedStaging,
  onCopy,
  onFetchExisting,
  onFetchWithIdentity,
  phase,
  requiresIdentity,
}: SavingsPlanFundingDetailsProps) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const [bvn, setBvn] = useState('');
  const isLoading = phase === 'loading';
  const needsIdentity = !isHostedStaging && requiresIdentity;
  // Staging never collects BVN: when identity is required there, say who
  // completes it instead of looping on a generic account lookup.
  const stagingIdentityBlocked = isHostedStaging && requiresIdentity;
  const isPending = phase === 'pending';
  // The funding fetch path does not schema-validate the response, so a ready
  // account with an empty number must not render a card whose copy button
  // confirms success while copying nothing usable.
  const usableAccount =
    (account?.accountNumber ?? '').trim() !== '' ? account : undefined;

  return (
    <View style={styles.content}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          Selected plan
        </Text>
        <Text style={[styles.goalTitle, { color: colors.text }]}>
          {goalTitle}
        </Text>
        <Text style={[styles.amount, { color: colors.text }]}>
          {formatNgnCurrency(amount)}
        </Text>
      </View>
      <Text style={[styles.copy, { color: colors.textSecondary }]}>
        {isHostedStaging
          ? 'This is a test environment. Do not send a real bank transfer; approved operators perform test funding. Card payments cannot fund this plan.'
          : 'Transfer from your bank app to this plan account. Card payments cannot fund this savings plan.'}
      </Text>
      {phase === 'ready' && usableAccount ? (
        <AccountDetails
          account={usableAccount}
          colors={colors}
          copied={copied}
          copyFailed={copyFailed}
          onCopy={onCopy}
        />
      ) : (
        <AccountLookup
          bvn={bvn}
          colors={colors}
          error={error}
          isLoading={isLoading}
          isPending={isPending}
          needsIdentity={needsIdentity}
          onBvnChange={setBvn}
          onFetchExisting={onFetchExisting}
          onFetchWithIdentity={() => onFetchWithIdentity(bvn)}
          stagingIdentityBlocked={stagingIdentityBlocked}
        />
      )}
    </View>
  );
}

function AccountDetails({
  account,
  colors,
  copied,
  copyFailed,
  onCopy,
}: {
  account: SavingsPlanFundingAccount;
  colors: FundingColors;
  copied: boolean;
  copyFailed: boolean;
  onCopy: () => Promise<void>;
}) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.label, { color: colors.textSecondary }]}>Bank</Text>
      <Text style={[styles.value, { color: colors.text }]}>
        {account.bankName}
      </Text>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        Account number
      </Text>
      <Text style={[styles.value, { color: colors.text }]}>
        {account.accountNumber}
      </Text>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        Account name
      </Text>
      <Text style={[styles.value, { color: colors.text }]}>
        {account.accountName}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Copy plan account number"
        onPress={() => void onCopy()}
        style={[styles.secondaryButton, { borderColor: colors.border }]}
      >
        <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
          {copied ? 'Copied' : 'Copy account number'}
        </Text>
      </Pressable>
      {copyFailed && !copied ? (
        <Text
          accessibilityRole="alert"
          style={[styles.copy, { color: colors.error }]}
        >
          Could not copy the account number. Please try again.
        </Text>
      ) : null}
    </View>
  );
}

function AccountLookup({
  bvn,
  colors,
  error,
  isLoading,
  isPending,
  needsIdentity,
  onBvnChange,
  onFetchExisting,
  onFetchWithIdentity,
  stagingIdentityBlocked,
}: {
  bvn: string;
  colors: FundingColors;
  error: string | null;
  isLoading: boolean;
  isPending: boolean;
  needsIdentity: boolean;
  onBvnChange: (value: string) => void;
  onFetchExisting: () => void;
  onFetchWithIdentity: () => void;
  stagingIdentityBlocked: boolean;
}) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.copy, { color: colors.textSecondary }]}>
        {isPending
          ? 'Your dedicated account is being prepared. Check its status again shortly.'
          : needsIdentity
            ? 'Enter the 11-digit BVN linked to this plan to set up its dedicated account.'
            : stagingIdentityBlocked
              ? 'This plan needs an identity check that approved operators complete in the test environment. Ask an operator to continue, then check the account status again.'
              : 'Looking for your existing dedicated account.'}
      </Text>
      {needsIdentity ? (
        <TextInput
          accessibilityLabel="BVN for plan account"
          editable={!isLoading}
          keyboardType="number-pad"
          maxLength={11}
          onChangeText={onBvnChange}
          placeholder="11-digit BVN"
          placeholderTextColor={colors.placeholder}
          secureTextEntry
          style={[
            styles.input,
            { borderColor: colors.border, color: colors.text },
          ]}
          value={bvn}
        />
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.copy, { color: colors.error }]}
        >
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          needsIdentity ? 'Show plan account' : 'Check account status'
        }
        disabled={isLoading}
        onPress={needsIdentity ? onFetchWithIdentity : onFetchExisting}
        style={[
          styles.primaryButton,
          { backgroundColor: colors.primary },
          isLoading && styles.disabled,
        ]}
      >
        <Text
          style={[
            styles.primaryButtonText,
            { color: colors.primaryForeground },
          ]}
        >
          {isLoading
            ? 'Loading...'
            : needsIdentity
              ? 'Show plan account'
              : 'Check account status'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  amount: { fontSize: 28, fontWeight: '800' },
  card: { borderRadius: 18, borderWidth: 1, gap: 8, padding: 18 },
  content: { gap: 16 },
  copy: { fontSize: 14, lineHeight: 21 },
  disabled: { opacity: 0.55 },
  goalTitle: { fontSize: 18, fontWeight: '700' },
  input: { borderRadius: 12, borderWidth: 1, fontSize: 17, padding: 13 },
  label: { fontSize: 13 },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 16,
  },
  primaryButtonText: { fontSize: 16, fontWeight: '700' },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  secondaryButtonText: { fontSize: 15, fontWeight: '600' },
  value: { fontSize: 17, fontWeight: '600' },
});

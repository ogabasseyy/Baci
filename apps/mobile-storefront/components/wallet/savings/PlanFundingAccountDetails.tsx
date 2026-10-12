import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { showAppAlert } from '@/components/ui/show-app-alert';
import { setClipboardString } from '@/lib/clipboard';
import type { SavingsPlanFundingAccount } from '@/schemas/customer-savings';
import { runCopyFundingAccount } from './run-copy-funding-account';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';

export function PlanFundingAccountDetails({
  account,
  colors,
}: {
  account: SavingsPlanFundingAccount | undefined;
  colors: StartSavingsColors;
}) {
  const [isCopying, setIsCopying] = useState(false);
  if (!account) {
    return null;
  }
  const handleCopyPlanAccount = () =>
    runCopyFundingAccount(async () => {
      const copied = await setClipboardString(account.accountNumber);
      showAppAlert({
        title: copied ? 'Copied' : 'Unable to copy',
        message: copied
          ? 'Account number copied to clipboard.'
          : 'Unable to copy account number.',
        variant: copied ? 'success' : 'error',
      });
    }, setIsCopying);

  return (
    <>
      <View style={styles.transferAccountRow}>
        <Text
          style={[styles.transferMetaLabel, { color: colors.textSecondary }]}
        >
          Account number
        </Text>
        <Text style={[styles.transferMetaValue, { color: colors.text }]}>
          {account.accountNumber}
        </Text>
      </View>
      <View style={styles.transferAccountRow}>
        <Text
          style={[styles.transferMetaLabel, { color: colors.textSecondary }]}
        >
          Account name
        </Text>
        <Text style={[styles.transferMetaValue, { color: colors.text }]}>
          {account.accountName}
        </Text>
      </View>
      <View style={styles.transferAccountRow}>
        <Text
          style={[styles.transferMetaLabel, { color: colors.textSecondary }]}
        >
          Bank
        </Text>
        <Text style={[styles.transferMetaValue, { color: colors.text }]}>
          {account.bankName}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Copy plan account number"
        accessibilityState={{ disabled: isCopying }}
        disabled={isCopying}
        style={[
          styles.secondaryButton,
          { borderColor: colors.border },
          isCopying ? styles.buttonDisabled : null,
        ]}
        onPress={handleCopyPlanAccount}
      >
        <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
          {isCopying ? 'Copying...' : 'Copy account'}
        </Text>
      </Pressable>
      <Text
        style={[
          styles.emptyFundingAccountText,
          { color: colors.textSecondary },
        ]}
      >
        Transfer to this account from your bank app, then confirm below.
      </Text>
    </>
  );
}

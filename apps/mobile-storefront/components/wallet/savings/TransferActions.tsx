import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import { handleSavingsActionError } from './handle-savings-action-error';
import { runCopyFundingAccount } from './run-copy-funding-account';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { TransferModalProps } from './start-savings-transfer-modal-props';

export function TransferActions({ colors, controller }: TransferModalProps) {
  const [isCopying, setIsCopying] = useState(false);

  const handleCopyFundingAccount = () =>
    runCopyFundingAccount(
      () => controller.handleCopyFundingAccount(),
      setIsCopying
    );

  const handleRetrySavingsCreation = async () => {
    try {
      await controller.submitSavingsGoal();
    } catch (error) {
      handleSavingsActionError(
        error,
        'Unable to retry savings',
        'Failed to retry savings creation. Please try again.'
      );
    }
  };

  return (
    <View style={styles.transferActionRow}>
      {controller.fundingAccount ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy savings funding account number"
          accessibilityState={{ disabled: isCopying }}
          disabled={isCopying}
          style={[
            styles.secondaryButton,
            { borderColor: colors.border },
            isCopying ? styles.buttonDisabled : null,
          ]}
          onPress={handleCopyFundingAccount}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
            {isCopying ? 'Copying...' : 'Copy account'}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry savings creation"
        accessibilityState={{ disabled: controller.isSubmitting }}
        style={[
          styles.secondaryButton,
          { borderColor: BRAND.primary, backgroundColor: BRAND.primary },
          controller.isSubmitting ? styles.buttonDisabled : null,
        ]}
        onPress={handleRetrySavingsCreation}
        disabled={controller.isSubmitting}
      >
        <Text style={[styles.secondaryButtonText, { color: palette.white }]}>
          I&apos;ve funded wallet
        </Text>
      </Pressable>
    </View>
  );
}

import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type Colors from '@/constants/Colors';
import { BRAND, withAlpha } from '@/constants/Colors';
import { styles } from './crypto-payment.styles';

interface CryptoPaymentViewProps {
  address?: string;
  amount?: string;
  chain?: string;
  chainLabel: string;
  colors: typeof Colors.light;
  confirmationTime?: string;
  copiedField: string | null;
  countdown: number;
  cryptoAmount?: string;
  currency?: string;
  error: string | null;
  isValid: boolean;
  onBack: () => void;
  onCopyAddress: () => void;
  onDone: () => void;
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatFiatAmount(amount?: string) {
  if (!amount) return null;
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return null;
  return `\u20A6${numericAmount.toLocaleString()} NGN`;
}

export function CryptoPaymentView({
  address,
  amount,
  chain,
  chainLabel,
  colors,
  confirmationTime,
  copiedField,
  countdown,
  cryptoAmount,
  currency,
  error,
  isValid,
  onBack,
  onCopyAddress,
  onDone,
}: CryptoPaymentViewProps) {
  if (!isValid) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={64} color={BRAND.primary} />
          <Text style={[styles.errorTitle, { color: colors.text }]}>
            Invalid Payment
          </Text>
          <Text style={[styles.errorMessage, { color: colors.textSecondary }]}>
            {error}
          </Text>
          <Pressable
            accessibilityLabel="Go Back"
            accessibilityRole="button"
            style={[styles.actionButton, { backgroundColor: BRAND.primary }]}
            onPress={onBack}
          >
            <Text style={[styles.actionButtonText, { color: BRAND.onPrimary }]}>
              Go Back
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const isExpiring = countdown < 300;
  const wasAddressCopied = copiedField === 'address';
  const fiatAmount = formatFiatAmount(amount);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom', 'left', 'right']}
    >
      <View style={styles.content}>
        <View
          style={[
            styles.timerBadge,
            {
              backgroundColor: isExpiring
                ? withAlpha(colors.error, 0.12)
                : BRAND.primaryAlpha06,
            },
          ]}
        >
          <Ionicons
            name="time-outline"
            size={16}
            color={isExpiring ? colors.error : BRAND.primary}
          />
          <Text
            style={[
              styles.timerText,
              { color: isExpiring ? colors.error : BRAND.primary },
            ]}
          >
            {countdown > 0
              ? `Payment expires in ${formatTime(countdown)}`
              : 'Payment window expired'}
          </Text>
        </View>

        <View style={[styles.amountCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.amountLabel, { color: colors.textSecondary }]}>
            Send exactly
          </Text>
          <Text style={[styles.amountValue, { color: colors.text }]}>
            {cryptoAmount || amount} {currency}
          </Text>
          <Text style={[styles.chainLabel, { color: colors.textSecondary }]}>
            on {chainLabel}
          </Text>
          {fiatAmount ? (
            <Text style={[styles.fiatAmount, { color: colors.textSecondary }]}>
              {fiatAmount}
            </Text>
          ) : null}
        </View>

        <View style={[styles.addressCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            Wallet Address ({chainLabel})
          </Text>
          <View style={styles.addressRow}>
            <Text
              style={[styles.addressText, { color: colors.text }]}
              selectable
              numberOfLines={2}
            >
              {address}
            </Text>
            <Pressable
              accessibilityLabel={
                wasAddressCopied
                  ? 'Wallet address copied'
                  : 'Copy wallet address'
              }
              accessibilityRole="button"
              style={[
                styles.copyButton,
                {
                  backgroundColor: wasAddressCopied
                    ? withAlpha(colors.success, 0.12)
                    : withAlpha(BRAND.primary, 0.08),
                },
              ]}
              onPress={onCopyAddress}
            >
              <Ionicons
                name={wasAddressCopied ? 'checkmark' : 'copy-outline'}
                size={18}
                color={wasAddressCopied ? colors.success : BRAND.primary}
              />
            </Pressable>
          </View>
        </View>

        {confirmationTime && (
          <View
            style={[
              styles.infoCard,
              { backgroundColor: withAlpha(BRAND.primary, 0.03) },
            ]}
          >
            <Ionicons
              name="information-circle"
              size={20}
              color={BRAND.primary}
            />
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>
              Expected confirmation: {confirmationTime}
            </Text>
          </View>
        )}

        <View
          style={[
            styles.warningCard,
            { backgroundColor: withAlpha(colors.warning, 0.12) },
          ]}
        >
          <Ionicons name="warning" size={20} color={colors.warning} />
          <View style={styles.warningContent}>
            <Text style={[styles.warningText, { color: colors.text }]}>
              Only send {currency} on the {chain} network. Sending other tokens
              or using the wrong network will result in permanent loss of funds.
            </Text>
          </View>
        </View>
      </View>

      <View
        style={[
          styles.bottomActions,
          { backgroundColor: colors.card, borderTopColor: colors.border },
        ]}
      >
        <Pressable
          accessibilityLabel="I've Sent the Payment"
          accessibilityRole="button"
          style={[styles.actionButton, { backgroundColor: BRAND.primary }]}
          onPress={onDone}
        >
          <Text style={[styles.actionButtonText, { color: BRAND.onPrimary }]}>
            I've Sent the Payment
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

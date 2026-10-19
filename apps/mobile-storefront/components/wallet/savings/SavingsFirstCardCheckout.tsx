import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { savingsCardContributionUtils as money } from './savings-card-contribution-utils';
import { useSavingsFirstCardCheckout } from './use-savings-first-card-checkout';

type Props = {
  colors: (typeof Colors)['light'];
  goalId: string;
  merchantId: string;
  onRefreshWallet?: () => Promise<unknown>;
  onCompleted?: () => Promise<unknown>;
  remainingAmount: number;
  userId: string;
};

export function SavingsFirstCardCheckout({
  colors,
  goalId,
  merchantId,
  onRefreshWallet,
  onCompleted,
  remainingAmount,
  userId,
}: Props) {
  const [amount, setAmount] = useState('');
  const checkout = useSavingsFirstCardCheckout({
    amount,
    goalId,
    merchantId,
    onAmountChange: setAmount,
    onCompleted,
    onRefreshWallet,
    remainingAmount,
    userId,
  });

  const scopeKey = JSON.stringify([goalId, merchantId, userId]);
  const scopeKeyRef = useRef(scopeKey);
  useEffect(() => {
    if (scopeKeyRef.current !== scopeKey) {
      scopeKeyRef.current = scopeKey;
      setAmount('');
    }
  }, [scopeKey]);

  if (
    checkout.loading ||
    (!checkout.enabled && !checkout.snapshot && !checkout.recoveryBlocked)
  )
    return null;
  const hasRequest = Boolean(checkout.snapshot);
  const completed = checkout.status === 'completed';
  const unresolved = hasRequest && !completed;
  const invalidAmount = Boolean(
    amount.trim() &&
      (!checkout.amountKobo || checkout.amountKobo > checkout.limitKobo)
  );
  const amountLabel = checkout.amountKobo
    ? money.formatAmount(checkout.amountKobo)
    : '';
  const reviewDisabled = !checkout.canStart || invalidAmount;

  return (
    <View style={[styles.container, { borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>Use a new card</Text>
      {checkout.recoveryBlocked ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.body, { color: colors.error }]}
        >
          Saved checkout data cannot be read. No new card charge can start.
          Resolve the saved request before trying another payment.
        </Text>
      ) : null}
      {!hasRequest ? (
        checkout.recoveryBlocked ? null : (
          <>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              Make a one-time contribution and save this card for future use.
              This does not enroll you in automatic payments.
            </Text>
            <Text style={[styles.label, { color: colors.text }]}>
              Amount to add
            </Text>
            <View
              style={[
                styles.input,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.currency, { color: colors.text }]}>₦</Text>
              <TextInput
                accessibilityLabel="New card contribution amount"
                editable={!checkout.busy}
                keyboardType="decimal-pad"
                onChangeText={(value) =>
                  setAmount(
                    value
                      .replace(/[^\d.]/g, '')
                      .replace(/(\.\d{0,2}).*|\./g, '$1')
                  )
                }
                placeholder="0.00"
                placeholderTextColor={colors.placeholder}
                style={[styles.field, { color: colors.text }]}
                value={amount}
              />
            </View>
            {checkout.limitKobo > 0 ? (
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                Up to {money.formatAmount(checkout.limitKobo)} per contribution
              </Text>
            ) : null}
            {invalidAmount ? (
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.body, { color: colors.error }]}
              >
                Enter an amount within the plan balance and checkout limit.
              </Text>
            ) : null}
            {!checkout.reviewing ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Review new card contribution"
                accessibilityState={{ disabled: reviewDisabled }}
                disabled={reviewDisabled}
                onPress={() => checkout.setReviewing(true)}
                style={[
                  styles.primary,
                  { backgroundColor: colors.primary },
                  reviewDisabled && styles.disabled,
                ]}
              >
                <Text
                  style={[styles.label, { color: colors.primaryForeground }]}
                >
                  Review contribution
                </Text>
              </Pressable>
            ) : null}
            {checkout.reviewing ? (
              <View style={styles.content}>
                <Text style={[styles.body, { color: colors.text }]}>
                  Confirm a one-time charge of {amountLabel} and save this card
                  for future use. Saving this card does not enable automatic
                  payments.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Confirm one-time new card charge ${amountLabel}`}
                  disabled={!checkout.canStart || invalidAmount}
                  onPress={() => void checkout.begin()}
                  style={[styles.primary, { backgroundColor: colors.primary }]}
                >
                  <Text
                    style={[styles.label, { color: colors.primaryForeground }]}
                  >
                    Continue to secure checkout
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel new card contribution review"
                  onPress={() => checkout.setReviewing(false)}
                >
                  <Text style={[styles.label, { color: colors.textSecondary }]}>
                    Cancel
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </>
        )
      ) : (
        <>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {completed
              ? `Payment confirmed for ${money.formatAmount(checkout.snapshot?.amountKobo ?? 0)}.`
              : `Saved one-time request for ${money.formatAmount(checkout.snapshot?.amountKobo ?? 0)}. Payment is not confirmed.`}
          </Text>
          {!completed ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                checkout.snapshot?.intentId
                  ? 'Check new card checkout status'
                  : 'Retry same new card checkout request'
              }
              disabled={checkout.busy}
              onPress={() => void checkout.begin()}
              style={[styles.secondary, { borderColor: colors.border }]}
            >
              <Text style={[styles.label, { color: colors.text }]}>
                {checkout.snapshot?.intentId
                  ? checkout.status === 'ready'
                    ? 'Continue secure checkout'
                    : 'Check payment status'
                  : 'Retry same checkout request'}
              </Text>
            </Pressable>
          ) : null}
          {checkout.allowRetry && !checkout.snapshot?.intentId ? (
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              Retry keeps the same request key. It will not create a second
              request.
            </Text>
          ) : null}
        </>
      )}
      {unresolved && checkout.snapshot?.intentId ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh new card checkout status"
          disabled={checkout.busy}
          onPress={() => void checkout.refreshStatus()}
          style={[styles.secondary, { borderColor: colors.border }]}
        >
          <Text style={[styles.label, { color: colors.text }]}>
            Refresh status
          </Text>
        </Pressable>
      ) : null}
      {checkout.message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.body, { color: colors.textSecondary }]}
        >
          {checkout.message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 12 },
  content: { gap: 12 },
  title: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 21 },
  label: { fontSize: 15, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  currency: { fontSize: 24 },
  field: { flex: 1, minWidth: 0, fontSize: 24, paddingVertical: 10 },
  primary: {
    minHeight: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
  secondary: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

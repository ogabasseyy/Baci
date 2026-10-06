import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SavingsCardContributionReview } from './SavingsCardContributionReview';
import { SavingsCardContributionStatus } from './SavingsCardContributionStatus';
import { SavingsCardMethodPicker } from './SavingsCardMethodPicker';
import type { SavingsPlanCardContributionViewProps as Props } from './SavingsPlanCardContributionView.types';

export function SavingsPlanCardContributionView({
  amount,
  amountLabel,
  amountKobo,
  allowRetry,
  busy,
  canStart,
  colors,
  enabled,
  expanded,
  invalidAmount,
  loading,
  message,
  methods,
  onAmountChange,
  onCancelReview,
  onCheckStatus,
  onConfirm,
  onRetry,
  onReview,
  onSelectMethod,
  onToggle,
  operationStatus,
  reviewing,
  canStartNew,
  capabilityLoaded,
  onNewContribution,
  selectedMethod,
  selectedMethodId,
  snapshot,
  sourceMode,
}: Props) {
  const hasSnapshot = Boolean(snapshot);
  return (
    <View style={[styles.container, { borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Pay by card"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={styles.header}
      >
        <Ionicons name="card-outline" size={22} color={colors.text} />
        <Text style={[styles.title, { color: colors.text }]}>Pay by card</Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textSecondary}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.content}>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {sourceMode === 'manual'
              ? 'Choose a saved card for a one-time contribution. This does not enable auto-debit.'
              : 'This is a one-time extra contribution. Your regular auto-debit schedule stays unchanged.'}
          </Text>
          <SavingsCardMethodPicker
            loading={loading}
            capabilityLoaded={capabilityLoaded}
            enabled={enabled}
            snapshot={snapshot}
            methods={methods}
            canStart={canStart}
            selectedMethodId={selectedMethodId}
            onSelectMethod={onSelectMethod}
            colors={colors}
          />
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
              accessibilityLabel="Card contribution amount"
              editable={canStart && !hasSnapshot}
              value={amount}
              onChangeText={(text) =>
                onAmountChange(
                  text.replace(/[^\d.]/g, '').replace(/(\.\d{0,2}).*|\./g, '$1')
                )
              }
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.placeholder}
              style={[styles.field, { color: colors.text }]}
            />
          </View>
          {invalidAmount ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.body, { color: colors.error }]}
            >
              Enter a valid amount within the plan balance and card limit.
            </Text>
          ) : null}
          <SavingsCardContributionReview
            selectedMethod={selectedMethod}
            amountKobo={amountKobo}
            amountLabel={amountLabel}
            snapshot={snapshot}
            reviewing={reviewing}
            canStart={canStart}
            invalidAmount={invalidAmount}
            busy={busy}
            onReview={onReview}
            onConfirm={onConfirm}
            onCancelReview={onCancelReview}
            colors={colors}
          />
          <SavingsCardContributionStatus
            snapshot={snapshot}
            operationStatus={operationStatus}
            allowRetry={allowRetry}
            busy={busy}
            canStartNew={canStartNew}
            message={message}
            onCheckStatus={onCheckStatus}
            onRetry={onRetry}
            onNewContribution={onNewContribution}
            colors={colors}
          />
        </View>
      ) : (
        <Text style={[styles.preview, { color: colors.textSecondary }]}>
          Optional one-time contribution from a saved card.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderWidth: 1, borderRadius: 20, padding: 16 },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: { flex: 1, fontSize: 16, fontWeight: '600' },
  content: { gap: 12, paddingTop: 10 },
  preview: { fontSize: 12, lineHeight: 18, marginTop: 4 },
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
});

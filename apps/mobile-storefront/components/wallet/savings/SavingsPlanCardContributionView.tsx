import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type Colors from '@/constants/Colors';
import type { SavingsCardContributionSnapshot } from '@/lib/savings-card-contribution-snapshot';

type SavedMethod = { id: string; brand: string; last4: string };
type OperationStatus =
  | 'pending'
  | 'completed'
  | 'collection_failed'
  | 'reconciliation_required';
type Props = {
  amount: string;
  amountLabel: string;
  amountKobo: number | null;
  allowRetry: boolean;
  busy: boolean;
  canStart: boolean;
  canStartNew: boolean;
  capabilityLoaded: boolean;
  colors: (typeof Colors)['light'];
  enabled: boolean;
  expanded: boolean;
  invalidAmount: boolean;
  loading: boolean;
  message: string;
  methods: SavedMethod[];
  onAmountChange: (amount: string) => void;
  onCancelReview: () => void;
  onCheckStatus: () => void;
  onConfirm: () => void;
  onRetry: () => void;
  onReview: () => void;
  onNewContribution: () => void;
  onSelectMethod: (id: string) => void;
  onToggle: () => void;
  operationStatus: OperationStatus | null;
  reviewing: boolean;
  selectedMethod: SavedMethod | undefined;
  selectedMethodId: string;
  snapshot: SavingsCardContributionSnapshot | null;
  sourceMode: 'manual' | 'auto_debit';
};

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
          {loading ? (
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              Loading saved cards…
            </Text>
          ) : null}
          {!loading && !capabilityLoaded ? (
            <Text style={[styles.notice, { color: colors.textSecondary }]}>
              Card contributions are unavailable right now.
            </Text>
          ) : null}
          {!loading && capabilityLoaded && !snapshot && methods.length === 0 ? (
            <Text style={[styles.notice, { color: colors.textSecondary }]}>
              No saved cards are available. New card setup is not available
              here.
            </Text>
          ) : null}
          {!loading && capabilityLoaded && !enabled && methods.length > 0 ? (
            <Text style={[styles.notice, { color: colors.textSecondary }]}>
              Card contributions are unavailable right now.
            </Text>
          ) : null}
          {enabled &&
            methods.map((method) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{
                  checked: selectedMethodId === method.id,
                  disabled: !canStart || hasSnapshot,
                }}
                disabled={!canStart || hasSnapshot}
                key={method.id}
                onPress={() => onSelectMethod(method.id)}
                style={[styles.method, { borderColor: colors.border }]}
              >
                <Ionicons name="card-outline" size={18} color={colors.text} />
                <Text style={[styles.body, { color: colors.text }]}>
                  {method.brand} •••• {method.last4}
                </Text>
              </Pressable>
            ))}
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
          {selectedMethod && amountKobo && !snapshot && !reviewing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Review card contribution"
              disabled={!canStart || invalidAmount}
              onPress={onReview}
              style={[styles.primary, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.label, { color: colors.primaryForeground }]}>
                Review contribution
              </Text>
            </Pressable>
          ) : null}
          {reviewing && selectedMethod && amountKobo ? (
            <View style={styles.content}>
              <Text style={[styles.body, { color: colors.text }]}>
                Confirm a one-time charge of {amountLabel} to{' '}
                {selectedMethod.brand} ending in {selectedMethod.last4}. This
                will not change your savings schedule.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Confirm one-time charge ${amountLabel}`}
                disabled={busy}
                onPress={onConfirm}
                style={[styles.primary, { backgroundColor: colors.primary }]}
              >
                <Text
                  style={[styles.label, { color: colors.primaryForeground }]}
                >
                  Confirm one-time charge
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel card contribution review"
                onPress={onCancelReview}
              >
                <Text style={[styles.label, { color: colors.textSecondary }]}>
                  Cancel
                </Text>
              </Pressable>
            </View>
          ) : null}
          {snapshot &&
          (operationStatus === null || operationStatus === 'pending') ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Check card contribution status"
                disabled={busy}
                onPress={onCheckStatus}
                style={[styles.secondary, { borderColor: colors.border }]}
              >
                <Text style={[styles.label, { color: colors.text }]}>
                  Check status
                </Text>
              </Pressable>
              {allowRetry ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry same card contribution request"
                  disabled={busy}
                  onPress={onRetry}
                  style={[styles.secondary, { borderColor: colors.border }]}
                >
                  <Text style={[styles.label, { color: colors.text }]}>
                    Retry same request
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
          {canStartNew ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start a new card contribution"
              disabled={busy}
              onPress={onNewContribution}
              style={[styles.secondary, { borderColor: colors.border }]}
            >
              <Text style={[styles.label, { color: colors.text }]}>
                Start a new contribution
              </Text>
            </Pressable>
          ) : null}
          {message ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.body, { color: colors.textSecondary }]}
            >
              {message}
            </Text>
          ) : null}
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
  notice: { fontSize: 13, lineHeight: 20 },
  label: { fontSize: 15, fontWeight: '600' },
  method: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  secondary: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
});

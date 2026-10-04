import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { SavingsPlanCardContributionViewProps } from './SavingsPlanCardContributionView.types';

type Props = Pick<
  SavingsPlanCardContributionViewProps,
  | 'loading'
  | 'capabilityLoaded'
  | 'enabled'
  | 'snapshot'
  | 'methods'
  | 'canStart'
  | 'selectedMethodId'
  | 'onSelectMethod'
  | 'colors'
>;

export function SavingsCardMethodPicker({
  loading,
  capabilityLoaded,
  enabled,
  snapshot,
  methods,
  canStart,
  selectedMethodId,
  onSelectMethod,
  colors,
}: Props) {
  return (
    <>
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
          No saved cards are available. New card setup is not available here.
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
              disabled: !canStart || Boolean(snapshot),
            }}
            disabled={!canStart || Boolean(snapshot)}
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
    </>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 21 },
  notice: { fontSize: 13, lineHeight: 20 },
  method: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
});

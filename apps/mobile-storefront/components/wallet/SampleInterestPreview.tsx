import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import type Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { useSampleInterestPreview } from './use-sample-interest-preview';

type WalletColors = (typeof Colors)['light'];

interface SampleInterestPreviewProps {
  colors: WalletColors;
  goal: Pick<
    WalletActiveSavingsGoal,
    'current_amount' | 'status' | 'title'
  > | null;
  ownerId: string | undefined;
  presentation: 'stack' | 'tab';
}

export function SampleInterestPreview({
  colors,
  goal,
  ownerId,
  presentation,
}: SampleInterestPreviewProps) {
  const { available, close, environmentEnabled, open, preview, visible } =
    useSampleInterestPreview(ownerId, goal);
  if (!environmentEnabled || !ownerId) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          available ? 'Preview sample interest' : 'Sample preview unavailable'
        }
        accessibilityState={{ disabled: !available }}
        disabled={!available}
        onPress={open}
        style={[
          styles.openButton,
          {
            backgroundColor: available ? colors.primary : colors.muted,
            bottom: presentation === 'tab' ? 72 : 24,
            borderColor: colors.border,
          },
        ]}
      >
        <Text
          style={[
            styles.openButtonText,
            {
              color: available
                ? colors.primaryForeground
                : colors.textSecondary,
            },
          ]}
        >
          {available ? 'Preview sample interest' : 'Sample preview unavailable'}
        </Text>
      </Pressable>
      {preview ? (
        <ModalSheet
          animationType="fade"
          cardStyle={[
            styles.card,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
          onRequestClose={close}
          visible={visible}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.title, { color: colors.text }]}>
              Interest preview
            </Text>
            <Text style={[styles.disclaimer, { color: colors.error }]}>
              Simulated preview—not a PiggyVest payout
            </Text>
            <Text style={[styles.goalTitle, { color: colors.textSecondary }]}>
              For {preview.goalTitle}
            </Text>
            <View style={styles.rows}>
              <AmountRow
                colors={colors}
                label="Savings before"
                value={formatNgnCurrency(preview.savingsBeforeKobo / 100)}
              />
              <AmountRow
                colors={colors}
                label="Savings after sample"
                value={formatNgnCurrency(preview.savingsAfterKobo / 100)}
              />
              <AmountRow
                colors={colors}
                label="Gross sample interest"
                value={formatNgnCurrency(preview.grossKobo / 100)}
              />
              <AmountRow
                colors={colors}
                label="Sample tax"
                value={formatNgnCurrency(preview.taxKobo / 100)}
              />
              <AmountRow
                colors={colors}
                label="Net sample earnings (included above)"
                value={formatNgnCurrency(preview.netKobo / 100)}
              />
            </View>
            <View
              style={[
                styles.notification,
                { backgroundColor: colors.muted, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.notificationTitle, { color: colors.text }]}>
                Example interest notification
              </Text>
              <Text
                style={[
                  styles.notificationText,
                  { color: colors.textSecondary },
                ]}
              >
                A simulated {formatNgnCurrency(preview.netKobo / 100)} interest
                preview for {preview.goalTitle}. No payout or push was sent.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close interest preview"
              onPress={close}
              style={[styles.closeButton, { backgroundColor: colors.primary }]}
            >
              <Text
                style={[styles.closeText, { color: colors.primaryForeground }]}
              >
                Close preview
              </Text>
            </Pressable>
          </ScrollView>
        </ModalSheet>
      ) : null}
    </>
  );
}

function AmountRow({
  colors,
  label,
  value,
}: {
  colors: WalletColors;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.amountRow}>
      <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Text style={[styles.rowValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  openButton: {
    alignSelf: 'center',
    borderRadius: 999,
    borderWidth: 1,
    elevation: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    position: 'absolute',
    zIndex: 10,
  },
  openButtonText: { fontSize: 13, fontWeight: '700' },
  card: {
    alignSelf: 'center',
    borderRadius: 20,
    borderWidth: 1,
    maxHeight: '85%',
    padding: 20,
    width: '100%',
  },
  content: { gap: 14 },
  title: { fontSize: 21, fontWeight: '700' },
  disclaimer: { fontSize: 15, fontWeight: '700' },
  goalTitle: { fontSize: 14 },
  rows: { gap: 10 },
  amountRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowLabel: { flex: 1, fontSize: 14 },
  rowValue: { fontSize: 14, fontWeight: '600' },
  notification: { borderRadius: 12, borderWidth: 1, gap: 6, padding: 12 },
  notificationTitle: { fontSize: 14, fontWeight: '700' },
  notificationText: { fontSize: 14, lineHeight: 20 },
  closeButton: { alignItems: 'center', borderRadius: 12, padding: 14 },
  closeText: { fontSize: 15, fontWeight: '700' },
});

import { Pressable, Text, TextInput, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import type {
  AmendmentWorkspace,
  VerifiedSettlementAction,
} from '@/lib/paid-order-amendment-api';
import { generateUUID } from '@/utils/uuid';

interface Props {
  verification: AmendmentWorkspace;
  colors: ThemeColors;
  disabled: boolean;
  outgoingEvidence: { claimId: string | null; value: string };
  setOutgoingEvidence: (value: {
    claimId: string | null;
    value: string;
  }) => void;
  onSubmit: (payload: VerifiedSettlementAction) => void;
}

export function PaidOrderVerifiedBankReturn({
  verification,
  colors,
  disabled,
  outgoingEvidence,
  setOutgoingEvidence,
  onSubmit,
}: Props) {
  const latestClaim = verification.events.findLast(
    (event) =>
      event.type === 'offline_disbursement_claimed' &&
      typeof event.details.claimId === 'string' &&
      !verification.events.some(
        (verified) =>
          verified.type === 'offline_disbursement_verified' &&
          verified.details.claimId === event.details.claimId
      )
  );
  const claimId =
    typeof latestClaim?.details.claimId === 'string'
      ? latestClaim.details.claimId
      : null;
  if (!verification.verifiedCancellationPending) return null;

  function action(label: string, onPress: () => void, actionDisabled = false) {
    const isDisabled = disabled || actionDisabled;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled }}
        disabled={isDisabled}
        onPress={onPress}
        style={{
          minHeight: 44,
          justifyContent: 'center',
          paddingHorizontal: 12,
        }}
      >
        <Text style={{ color: isDisabled ? colors.textMuted : colors.primary }}>
          {label}
        </Text>
      </Pressable>
    );
  }

  if (claimId) {
    const value =
      outgoingEvidence.claimId === claimId ? outgoingEvidence.value : '';
    return (
      <View>
        <TextInput
          accessibilityLabel="Verified outgoing bank evidence ID"
          autoCapitalize="none"
          value={value}
          onChangeText={(nextValue) =>
            setOutgoingEvidence({ claimId, value: nextValue })
          }
          maxLength={36}
          style={{
            color: colors.text,
            borderColor: colors.border,
            borderWidth: 1,
            padding: 12,
          }}
        />
        {action(
          'Verify bank repayment',
          () => {
            onSubmit({
              action: 'record_offline_refund',
              claimId,
              evidenceId: value.trim(),
              idempotencyKey: generateUUID(),
            });
          },
          !value.trim()
        )}
      </View>
    );
  }

  return (
    <View>
      {verification.bankEvidence
        .filter(
          (entry) =>
            entry.method === 'bank_transfer' &&
            (entry.status === null || entry.status === 'unapplied')
        )
        .map((entry) => (
          <View key={entry.id}>
            {action(
              `Prepare bank repayment (${new Intl.NumberFormat('en-NG', {
                style: 'currency',
                currency: 'NGN',
              }).format(entry.amountMinor / 100)})`,
              () => {
                onSubmit({
                  action: 'claim_offline_disbursement',
                  sourceKind: 'unapplied',
                  sourceId: entry.id,
                  idempotencyKey: generateUUID(),
                });
              }
            )}
          </View>
        ))}
    </View>
  );
}

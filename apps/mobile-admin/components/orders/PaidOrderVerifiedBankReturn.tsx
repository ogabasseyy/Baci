import {
  findLatestOpenDisbursementClaim,
  paidOrderEvidenceIdSchema,
} from '@baci/shared';
import { Pressable, Text, TextInput, View } from 'react-native';
import { formatPrice } from '@/components/orders-screen/format-price';
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
  const latestClaim = findLatestOpenDisbursementClaim(verification.events);
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
    const evidenceIdIsValid = paidOrderEvidenceIdSchema.safeParse(
      value.trim()
    ).success;
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
          !value.trim() || !evidenceIdIsValid
        )}
        <Text style={{ color: colors.textMuted }}>
          Enter a valid evidence UUID from the verified bank transfer.
        </Text>
      </View>
    );
  }

  const repayableEvidence = verification.bankEvidence.filter(
    (entry) =>
      entry.method === 'bank_transfer' &&
      (entry.status === null || entry.status === 'unapplied')
  );

  return (
    <View>
      {repayableEvidence.length === 0 ? (
        <Text style={{ color: colors.textMuted }}>
          No unallocated bank transfers need repayment.
        </Text>
      ) : (
        repayableEvidence.map((entry) => (
          <View key={entry.id}>
            <Text style={{ color: colors.textMuted }}>
              Transfer {entry.transactionId ?? entry.occurredAt}
            </Text>
            {action(
              `Prepare bank repayment (${formatPrice(entry.amountMinor / 100)})`,
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
        ))
      )}
    </View>
  );
}

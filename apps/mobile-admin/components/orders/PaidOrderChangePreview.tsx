import { formatOrderItemDisplayName } from '@baci/shared';
import type { ReactNode } from 'react';
import {
  type StyleProp,
  Text,
  TextInput,
  type TextStyle,
  View,
} from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import type { AmendmentPreview } from '@/lib/paid-order-amendment-api';

interface Props {
  preview: AmendmentPreview;
  formatPrice: (amount: number) => string;
  action: (
    label: string,
    press: () => void,
    disabled?: boolean,
    selected?: boolean
  ) => ReactNode;
  inputStyle: StyleProp<TextStyle>;
  busy: boolean;
  canRefund: boolean;
  evidence: { id: string; select: (id: string) => void };
  staffPayment: {
    method: 'cash' | 'pos' | null;
    selectMethod: (method: 'cash' | 'pos') => void;
    receiptReference: string;
    setReceiptReference: (reference: string) => void;
  };
  reason: string;
  setReason: (value: string) => void;
}

export function PaidOrderChangePreview({
  preview,
  formatPrice,
  action,
  inputStyle,
  busy,
  canRefund,
  evidence,
  staffPayment,
  reason,
  setReason,
}: Props) {
  const { colors } = useTheme();
  const money = (minor: number) => formatPrice(minor / 100);
  const canRecordStaffTopUp = preview.canRecordStaffTopUp === true;
  const requiresEvidence = Boolean(
    preview.bankEvidence && preview.adjustmentMinor > 0
  );
  return (
    <>
      {[preview.beforeLine, preview.afterLine].map((line, index) => (
        <Text
          key={index === 0 ? 'original' : 'revised'}
          style={{ color: colors.text }}
        >
          {index === 0 ? 'Original' : 'Revised'} ·{' '}
          {formatOrderItemDisplayName({
            baseName: line.name,
            variantName: line.variantName,
            condition: line.condition,
          })}{' '}
          × {line.quantity} ·{' '}
          {money(
            index === 0 ? preview.beforeTotalMinor : preview.afterTotalMinor
          )}
        </Text>
      ))}
      <Text style={{ color: colors.text }}>
        {preview.adjustmentMinor === 0
          ? 'Same price'
          : preview.adjustmentMinor > 0
            ? `Extra payment ${money(preview.adjustmentMinor)}`
            : `Refund owed ${money(-preview.adjustmentMinor)}`}
      </Text>
      {canRecordStaffTopUp && (
        <>
          <Text style={{ color: colors.text }}>Record payment</Text>
          {action(
            'Cash',
            () => staffPayment.selectMethod('cash'),
            false,
            staffPayment.method === 'cash'
          )}
          {action(
            'POS',
            () => staffPayment.selectMethod('pos'),
            false,
            staffPayment.method === 'pos'
          )}
          {staffPayment.method === 'pos' && (
            <>
              <TextInput
                accessibilityLabel="POS receipt reference"
                placeholder="POS receipt reference"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={100}
                editable={!busy}
                value={staffPayment.receiptReference}
                onChangeText={staffPayment.setReceiptReference}
                style={inputStyle}
              />
              <Text style={{ color: colors.textMuted }}>
                Use 8–100 letters, numbers, _, ., /, : or -.
              </Text>
            </>
          )}
        </>
      )}
      {requiresEvidence && !canRecordStaffTopUp && (
        <>
          <Text style={{ color: colors.text }}>
            {preview.bankEvidence?.length
              ? 'Select the verified top-up.'
              : 'No matching payment has been verified. Finance must verify the incoming payment before this change can be confirmed.'}
          </Text>
          {preview.bankEvidence?.map((entry) => (
            <View key={entry.id}>
              {action(
                `${entry.method === 'cash' ? 'Cash' : entry.method === 'pos' ? 'POS' : 'Bank transfer'} · ${money(entry.amountMinor)} · ${entry.id.slice(0, 8)}`,
                () => evidence.select(entry.id),
                false,
                evidence.id === entry.id
              )}
            </View>
          ))}
        </>
      )}
      {preview.adjustmentMinor < 0 && !canRefund && (
        <Text style={{ color: colors.textSecondary }}>
          A staff member with refund permission must confirm.
        </Text>
      )}
      <TextInput
        accessibilityLabel="Reason for the change"
        placeholder="Reason for the change"
        placeholderTextColor={colors.textMuted}
        maxLength={500}
        editable={!busy}
        value={reason}
        onChangeText={setReason}
        style={inputStyle}
      />
    </>
  );
}

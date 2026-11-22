import { formatOrderItemDisplayName } from '@baci/shared';
import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AppSheetModal } from '@/components/ui/AppSheetModal';
import { SPACING } from '@/constants/theme';
import type { usePaidOrderAmendment } from '@/hooks/orders/usePaidOrderAmendment';
import { useTheme } from '@/hooks/useTheme';
import {
  type AmendmentPreview,
  type AmendmentReplacement,
  paidOrderAmendment,
  staffTopUpSchema,
} from '@/lib/paid-order-amendment-api';
import { generateUUID } from '@/utils/uuid';
import type { OrderDetailsItem } from './order-details.types';

interface Props {
  orderId: string;
  items: Pick<OrderDetailsItem, 'id' | 'name' | 'variant_name'>[];
  formatPrice: (amount: number) => string;
  amendment: ReturnType<typeof usePaidOrderAmendment>;
  onClose: () => void;
}

export function PaidOrderChangeItemsSheet({
  orderId,
  items,
  formatPrice,
  amendment,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const [lineId, setLineId] = useState(items[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<AmendmentReplacement[] | null>(null);
  const [preview, setPreview] = useState<AmendmentPreview | null>(null);
  const [evidenceId, setEvidenceId] = useState('');
  const [staffMethod, setStaffMethod] = useState<'cash' | 'pos' | null>(null);
  const [receiptReference, setReceiptReference] = useState('');
  const [reason, setReason] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  const money = (minor: number) => formatPrice(minor / 100);
  const { pending } = amendment;
  const requiresEvidence = Boolean(
    preview?.bankEvidence && preview.adjustmentMinor > 0
  );

  const canRecordStaffTopUp = preview?.canRecordStaffTopUp === true;
  const staffTopUp = staffTopUpSchema.safeParse(
    staffMethod === 'pos'
      ? { method: staffMethod, receiptReference }
      : { method: staffMethod }
  ).data;

  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to load the order change.'
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function showOutcome(outcome: 'confirmed' | 'competing' | 'unknown') {
    if (outcome === 'unknown') {
      setMessage(
        'Confirmation is still unverified. Check its status or retry the same request.'
      );
      return;
    }
    if (outcome === 'competing') {
      setMessage('Another change is already recorded for this order.');
      setPreview(null);
      setResults(null);
      return;
    }
    onClose();
  }

  function resetPreview() {
    setPreview(null);
    setAgreed(false);
    setEvidenceId('');
    setStaffMethod(null);
    setReceiptReference('');
  }

  function action(
    label: string,
    press: () => void,
    disabled = false,
    selected?: boolean
  ) {
    return (
      <Pressable
        key={label}
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || busy, selected }}
        disabled={disabled || busy}
        onPress={press}
        style={{
          minHeight: 44,
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: selected ? colors.primary : colors.border,
          borderRadius: 8,
          padding: SPACING.sm,
          opacity: disabled || busy ? 0.55 : 1,
        }}
      >
        <Text style={{ color: colors.primary }}>{label}</Text>
      </Pressable>
    );
  }

  const inputStyle = {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: SPACING.sm,
  };

  return (
    <AppSheetModal
      visible
      accessibilityLabel="Change items"
      onClose={() => {
        if (!inFlight.current) onClose();
      }}
    >
      <View style={{ gap: SPACING.sm }}>
        <Text style={{ color: colors.text, fontSize: 21, fontWeight: '700' }}>
          Change items
        </Text>
        {pending ? (
          <>
            <Text style={{ color: colors.text }}>
              A confirmation needs to be checked.
            </Text>
            {action(
              'Check confirmation status',
              () =>
                void run(async () =>
                  showOutcome(await amendment.checkConfirmation(pending))
                )
            )}
            {action(
              'Retry the same confirmation',
              () =>
                void run(async () =>
                  showOutcome(await amendment.confirm(pending))
                )
            )}
          </>
        ) : (
          <>
            {items.length > 1 &&
              items.map((item) =>
                action(
                  formatOrderItemDisplayName({
                    baseName: item.name,
                    variantName: item.variant_name,
                  }),
                  () => {
                    setLineId(item.id);
                    setResults(null);
                    resetPreview();
                  },
                  false,
                  lineId === item.id
                )
              )}
            <TextInput
              accessibilityLabel="Find a replacement"
              placeholder="Find a replacement"
              placeholderTextColor={colors.textMuted}
              style={inputStyle}
              value={search}
              maxLength={80}
              editable={!busy}
              onChangeText={(value) => {
                setSearch(value);
                setResults(null);
                resetPreview();
              }}
            />
            {action(
              'Search catalog',
              () =>
                void run(async () => {
                  resetPreview();
                  setResults(
                    await paidOrderAmendment.search(
                      orderId,
                      lineId,
                      search.trim()
                    )
                  );
                }),
              !lineId || search.trim().length < 2
            )}
            {results?.length === 0 && (
              <Text style={{ color: colors.textSecondary }}>
                No matching replacements.
              </Text>
            )}
            {results?.map((item) => (
              <View key={item.id}>
                {action(
                  item.label,
                  () =>
                    void run(async () => {
                      resetPreview();
                      setPreview(
                        await paidOrderAmendment.preview(orderId, lineId, item)
                      );
                    })
                )}
              </View>
            ))}
            {preview && (
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
                      index === 0
                        ? preview.beforeTotalMinor
                        : preview.afterTotalMinor
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
                      () => setStaffMethod('cash'),
                      false,
                      staffMethod === 'cash'
                    )}
                    {action(
                      'POS',
                      () => setStaffMethod('pos'),
                      false,
                      staffMethod === 'pos'
                    )}
                    {staffMethod === 'pos' && (
                      <TextInput
                        accessibilityLabel="POS receipt reference"
                        placeholder="POS receipt reference"
                        placeholderTextColor={colors.textMuted}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        maxLength={100}
                        editable={!busy}
                        value={receiptReference}
                        onChangeText={setReceiptReference}
                        style={inputStyle}
                      />
                    )}
                  </>
                )}
                {requiresEvidence && !canRecordStaffTopUp && (
                  <>
                    <Text style={{ color: colors.text }}>
                      {preview.bankEvidence?.length
                        ? 'Select the verified top-up.'
                        : 'No matching payment has been verified.'}
                    </Text>
                    {preview.bankEvidence?.map((entry) => (
                      <View key={entry.id}>
                        {action(
                          `${entry.method === 'cash' ? 'Cash' : entry.method === 'pos' ? 'POS' : 'Bank transfer'} · ${money(entry.amountMinor)} · ${entry.id.slice(0, 8)}`,
                          () => setEvidenceId(entry.id),
                          false,
                          evidenceId === entry.id
                        )}
                      </View>
                    ))}
                  </>
                )}
                {preview.adjustmentMinor < 0 && !amendment.canRefund && (
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
                {action(
                  agreed ? 'Customer agreed ✓' : 'Customer agreed',
                  () => setAgreed(!agreed),
                  false,
                  agreed
                )}
                {action(
                  canRecordStaffTopUp
                    ? 'Record payment and confirm change'
                    : 'Confirm change',
                  () =>
                    void run(async () =>
                      showOutcome(
                        await amendment.confirm({
                          previewId: preview.previewId,
                          idempotencyKey: generateUUID(),
                          reason: reason.trim(),
                          customerAgreed: true,
                          ...(canRecordStaffTopUp && staffTopUp
                            ? { staffTopUp }
                            : requiresEvidence
                              ? { bankEvidenceId: evidenceId }
                              : {}),
                        })
                      )
                    ),
                  !amendment.canStart ||
                    !agreed ||
                    !reason.trim() ||
                    (canRecordStaffTopUp
                      ? !staffTopUp
                      : requiresEvidence && !evidenceId) ||
                    (preview.adjustmentMinor < 0 && !amendment.canRefund)
                )}
              </>
            )}
          </>
        )}
        {message ? (
          <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
            {message}
          </Text>
        ) : null}
        {action('Close', onClose)}
      </View>
    </AppSheetModal>
  );
}

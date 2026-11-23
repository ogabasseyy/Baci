import { formatOrderItemDisplayName, staffTopUpSchema } from '@baci/shared';
import { useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { AppSheetModal } from '@/components/ui/AppSheetModal';
import { SPACING } from '@/constants/theme';
import type { usePaidOrderAmendment } from '@/hooks/orders/usePaidOrderAmendment';
import { useTheme } from '@/hooks/useTheme';
import {
  type AmendmentPreview,
  type AmendmentReplacement,
  paidOrderAmendment,
} from '@/lib/paid-order-amendment-api';
import { generateUUID } from '@/utils/uuid';
import type { OrderDetailsItem } from './order-details.types';
import { PaidOrderChangeAction } from './PaidOrderChangeAction';
import { PaidOrderChangePreview } from './PaidOrderChangePreview';

interface Props {
  orderId: string;
  items: Pick<
    OrderDetailsItem,
    'id' | 'name' | 'variant_name' | 'condition' | 'display_condition'
  >[];
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
  const { pending, pendingUnreadable } = amendment;
  const requiresEvidence =
    preview?.bankEvidence !== undefined && preview.adjustmentMinor > 0;
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
    selected?: boolean,
    key = label
  ) {
    return (
      <PaidOrderChangeAction
        key={key}
        label={label}
        onPress={press}
        disabled={disabled || busy}
        selected={selected}
      />
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
        {pendingUnreadable ? (
          <>
            <Text style={{ color: colors.text }}>
              The saved confirmation could not be read. Reload the order status
              before starting another change.
            </Text>
            {action(
              'Reload order status',
              () =>
                void run(async () => {
                  await amendment.recoverUnreadableConfirmation();
                  setMessage(
                    'Order status reloaded. Close and reopen Change items to continue.'
                  );
                })
            )}
          </>
        ) : pending ? (
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
                    condition: item.display_condition ?? item.condition,
                  }),
                  () => {
                    setLineId(item.id);
                    setResults(null);
                    resetPreview();
                  },
                  false,
                  lineId === item.id,
                  item.id
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
                <PaidOrderChangePreview
                  preview={preview}
                  formatPrice={formatPrice}
                  action={action}
                  inputStyle={inputStyle}
                  busy={busy}
                  canRefund={amendment.canRefund}
                  evidence={{ id: evidenceId, select: setEvidenceId }}
                  staffPayment={{
                    method: staffMethod,
                    selectMethod: setStaffMethod,
                    receiptReference,
                    setReceiptReference,
                  }}
                  reason={reason}
                  setReason={setReason}
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

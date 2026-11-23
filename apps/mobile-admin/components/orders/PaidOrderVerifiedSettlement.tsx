import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AppSheetModal } from '@/components/ui/AppSheetModal';
import type { ThemeColors } from '@/constants/theme';
import { AuthenticatedFetchPreflightError } from '@/hooks/orders/authenticated-fetch';
import {
  type AmendmentWorkspace,
  PaidOrderAmendmentError,
  paidOrderAmendment,
  type VerifiedSettlementAction,
  verifiedSettlementActionSchema,
} from '@/lib/paid-order-amendment-api';
import { asyncStorage } from '@/lib/storage';
import { generateUUID } from '@/utils/uuid';
import { PaidOrderVerifiedBankReturn } from './PaidOrderVerifiedBankReturn';

interface Props {
  orderId: string;
  amendmentId: string;
  operatorId: string;
  verification: AmendmentWorkspace;
  colors: ThemeColors;
  refreshOrder: () => Promise<boolean>;
}

const unreadableSettlementMessage =
  'A saved settlement request could not be read. Reload the order status before starting another settlement action.';

export function PaidOrderVerifiedSettlement({
  orderId,
  amendmentId,
  operatorId,
  verification,
  colors,
  refreshOrder,
}: Props) {
  const client = useQueryClient();
  const key = [
    'verified-amendment-operation',
    operatorId,
    orderId,
    amendmentId,
  ];
  const storageKey = key.join(':');
  const unreadableKey = `${storageKey}:unreadable`;
  const [unreadableMessage, setUnreadableMessage] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useQuery({
    queryKey: key,
    queryFn: async () => {
      if ((await asyncStorage.getItem(unreadableKey)) === '1') {
        setUnreadableMessage(true);
        setMessage(unreadableSettlementMessage);
        return { unreadable: true as const };
      }
      const saved = await asyncStorage.getItem(storageKey);
      if (!saved) return null;
      let decoded: unknown;
      try {
        decoded = JSON.parse(saved);
      } catch {
        decoded = undefined;
      }
      const parsed = verifiedSettlementActionSchema.safeParse(decoded);
      if (parsed.success) return parsed.data;
      try {
        await asyncStorage.setItem(unreadableKey, '1');
      } catch {
        setUnreadableMessage(true);
        setMessage(unreadableSettlementMessage);
        return { unreadable: true as const };
      }
      try {
        await asyncStorage.removeItem(storageKey);
      } catch {
        // The durable marker keeps the recovery action available to retry.
      }
      setUnreadableMessage(true);
      setMessage(unreadableSettlementMessage);
      return { unreadable: true as const };
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const isVerifiedAction = (
    value: typeof pending.data
  ): value is VerifiedSettlementAction =>
    Boolean(value && !('unreadable' in value));
  const unreadableSavedAction =
    (pending.data !== undefined &&
      pending.data !== null &&
      !isVerifiedAction(pending.data)) ||
    unreadableMessage;
  const recoveryRequired = unreadableSavedAction || refreshRequired;
  const savedAction = isVerifiedAction(pending.data) ? pending.data : null;
  const [cancellation, setCancellation] = useState<
    'open_verified_cancellation' | 'cancel_with_verified_refunds' | null
  >(null);
  const [reason, setReason] = useState('');
  const [outgoingEvidence, setOutgoingEvidence] = useState<{
    claimId: string | null;
    value: string;
  }>({ claimId: null, value: '' });
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const canCancel =
    verification.canOpenVerifiedCancellation ||
    verification.verifiedCancellationReady;
  const closing = cancellation === 'cancel_with_verified_refunds';
  const visible =
    cancellation ||
    savedAction ||
    unreadableSavedAction ||
    refreshRequired ||
    pending.isError ||
    canCancel ||
    verification.verifiedCreditDirectRefund ||
    verification.verifiedCancellationPending;
  if (!visible) return null;

  function action(label: string, onPress: () => void, disabled = false) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || busy }}
        disabled={disabled || busy}
        onPress={onPress}
        style={{
          minHeight: 44,
          justifyContent: 'center',
          paddingHorizontal: 12,
        }}
      >
        <Text
          style={{
            color: disabled || busy ? colors.textMuted : colors.primary,
          }}
        >
          {label}
        </Text>
      </Pressable>
    );
  }

  async function submit(payload: VerifiedSettlementAction, retrySaved = false) {
    if (inFlight.current || (recoveryRequired && !retrySaved)) return;
    const wasPending = Boolean(savedAction);
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    const clear = async () => {
      await asyncStorage.removeItem(storageKey);
      client.setQueryData(key, null);
    };
    try {
      await asyncStorage.setItem(storageKey, JSON.stringify(payload));
      client.setQueryData(key, payload);
      try {
        await paidOrderAmendment.finance(orderId, amendmentId, payload);
      } catch (error) {
        // A transport failure may follow a server commit. Keep the exact
        // command until a confirmed result or an authoritative rejection.
        const rejected = error instanceof PaidOrderAmendmentError;
        const definitiveRejection = wasPending
          ? rejected &&
            error.status === 409 &&
            Boolean(error.code) &&
            error.code !== 'amendment_busy'
          : error instanceof AuthenticatedFetchPreflightError ||
            (rejected &&
              error.status >= 400 &&
              error.status < 500 &&
              error.status !== 408);
        if (definitiveRejection) {
          await clear();
          throw error;
        }
        setMessage(
          rejected && [401, 403, 404, 429].includes(error.status)
            ? `${error.message} The earlier request is still saved for retry.`
            : 'Unable to verify the outcome. Retry the same request to check it.'
        );
        return;
      }
      await clear();
      setReason('');
      setOutgoingEvidence({ claimId: null, value: '' });
      setCancellation(null);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to update settlement.'
      );
    } finally {
      const refreshed = await refreshOrder().catch(() => false);
      if (!refreshed) {
        setRefreshRequired(true);
        setMessage(
          'Reload order status before starting another settlement action.'
        );
      }
      setBusy(false);
      inFlight.current = false;
    }
  }

  function retrySavedAction(payload: VerifiedSettlementAction) {
    return action('Retry the same settlement request', () => {
      void submit(payload, true);
    });
  }

  async function reloadOrderStatus() {
    setBusy(true);
    setMessage('Refreshing order status…');
    try {
      const refreshed = await refreshOrder();
      if (!refreshed) {
        setMessage('Unable to refresh order status. Try again.');
        return;
      }
      if (unreadableSavedAction) {
        await asyncStorage.removeItem(storageKey);
        await asyncStorage.removeItem(unreadableKey);
        client.setQueryData(key, null);
        setUnreadableMessage(false);
      }
      setRefreshRequired(false);
      setMessage('Order status refreshed.');
    } catch {
      setMessage('Unable to refresh order status. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      {verification.verifiedCancellationPending && (
        <Text style={{ color: colors.text, paddingHorizontal: 12 }}>
          {verification.verifiedCancellationReady
            ? 'Refund evidence complete.'
            : 'Fulfillment is on hold while Finance verifies each refund.'}
        </Text>
      )}
      {pending.isError && (
        <>
          <Text style={{ color: colors.text }}>
            Unable to read the saved settlement request. Retry before
            continuing.
          </Text>
          {action(
            'Retry saved settlement check',
            () => void pending.refetch(),
            busy
          )}
        </>
      )}
      {recoveryRequired &&
        !cancellation &&
        action('Reload order status', () => void reloadOrderStatus(), busy)}
      {savedAction ? (
        !cancellation && retrySavedAction(savedAction)
      ) : (
        <>
          {verification.verifiedCreditDirectRefund &&
            action(
              'Record verified Credit Direct refund',
              () =>
                void submit({
                  action: 'record_verified_lender_refund',
                  idempotencyKey: generateUUID(),
                }),
              !pending.isSuccess || recoveryRequired
            )}
          {canCancel &&
            action(
              verification.verifiedCancellationReady
                ? 'Cancel with verified refunds'
                : 'Put order on hold for cancellation',
              () => {
                setCancellation(
                  verification.verifiedCancellationReady
                    ? 'cancel_with_verified_refunds'
                    : 'open_verified_cancellation'
                );
                setMessage('');
              },
              !pending.isSuccess || recoveryRequired
            )}
        </>
      )}
      {!cancellation && message && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
          {message}
        </Text>
      )}
      {!cancellation &&
        verification.verifiedCancellationPending &&
        !savedAction && (
          <PaidOrderVerifiedBankReturn
            verification={verification}
            colors={colors}
            disabled={busy || !pending.isSuccess || recoveryRequired}
            outgoingEvidence={outgoingEvidence}
            setOutgoingEvidence={setOutgoingEvidence}
            onSubmit={(payload) => void submit(payload)}
          />
        )}
      {cancellation && (
        <AppSheetModal
          visible
          accessibilityLabel="Verified cancellation"
          onClose={() => {
            if (!inFlight.current) setCancellation(null);
          }}
        >
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 20 }}>
            {closing
              ? 'Cancel with verified refunds'
              : 'Hold fulfillment for cancellation'}
          </Text>
          <Text style={{ color: colors.text, marginVertical: 12 }}>
            {closing
              ? 'This marks the order cancelled, posts the verified refunds, and returns stock to inventory.'
              : 'Finance will verify Credit Direct and any separate top-up before the order is cancelled.'}
          </Text>
          <TextInput
            accessibilityLabel="Cancellation reason"
            placeholder="Cancellation reason"
            placeholderTextColor={colors.textMuted}
            value={reason}
            onChangeText={setReason}
            editable={!busy}
            maxLength={500}
            style={{
              color: colors.text,
              borderColor: colors.border,
              borderWidth: 1,
              padding: 12,
            }}
          />
          {savedAction
            ? retrySavedAction(savedAction)
            : action(
                'Confirm',
                () =>
                  void submit({
                    action: cancellation,
                    idempotencyKey: generateUUID(),
                    reason: reason.trim(),
                  }),
                !reason.trim() ||
                  recoveryRequired ||
                  !pending.isSuccess ||
                  !(closing
                    ? verification.verifiedCancellationReady
                    : verification.canOpenVerifiedCancellation)
              )}
          {recoveryRequired &&
            action('Reload order status', () => void reloadOrderStatus(), busy)}
          {message && (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: colors.text }}
            >
              {message}
            </Text>
          )}
          {action('Close', () => setCancellation(null))}
        </AppSheetModal>
      )}
    </View>
  );
}

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

interface Props {
  orderId: string;
  amendmentId: string;
  operatorId: string;
  verification: AmendmentWorkspace;
  colors: ThemeColors;
  refreshOrder: () => void;
}

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
  const pending = useQuery({
    queryKey: key,
    queryFn: async () => {
      const saved = await asyncStorage.getItem(storageKey);
      return saved
        ? verifiedSettlementActionSchema.parse(JSON.parse(saved))
        : null;
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const [cancellation, setCancellation] = useState<
    'open_verified_cancellation' | 'cancel_with_verified_refunds' | null
  >(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const canCancel =
    verification.canOpenVerifiedCancellation ||
    verification.verifiedCancellationReady;
  const closing = cancellation === 'cancel_with_verified_refunds';
  const visible =
    cancellation ||
    pending.data ||
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

  async function submit(payload: VerifiedSettlementAction) {
    if (inFlight.current) return;
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
        const outcomeKnown =
          error instanceof PaidOrderAmendmentError &&
          error.status >= 400 &&
          error.status < 500 &&
          ![401, 403, 408, 429].includes(error.status);
        if (
          outcomeKnown ||
          (!pending.data && error instanceof AuthenticatedFetchPreflightError)
        ) {
          await clear();
          throw error;
        }
        setMessage(
          'Unable to verify the outcome. Retry the same request to check it.'
        );
        return;
      }
      await clear();
      setReason('');
      setCancellation(null);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to update settlement.'
      );
    } finally {
      refreshOrder();
      setBusy(false);
      inFlight.current = false;
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
      {pending.data ? (
        !cancellation &&
        action('Retry the same settlement request', () => {
          if (pending.data) void submit(pending.data);
        })
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
              !pending.isSuccess
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
              !pending.isSuccess
            )}
        </>
      )}
      {!cancellation && message && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
          {message}
        </Text>
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
          {pending.data
            ? action('Retry the same settlement request', () => {
                if (pending.data) void submit(pending.data);
              })
            : action(
                'Confirm',
                () =>
                  void submit({
                    action: cancellation,
                    idempotencyKey: generateUUID(),
                    reason: reason.trim(),
                  }),
                !reason.trim() ||
                  !pending.isSuccess ||
                  !(closing
                    ? verification.verifiedCancellationReady
                    : verification.canOpenVerifiedCancellation)
              )}
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

import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import { AuthenticatedFetchPreflightError } from '@/hooks/orders/authenticated-fetch';
import { usePaidOrderSettlementPending } from '@/hooks/orders/usePaidOrderSettlementPending';
import {
  type AmendmentWorkspace,
  PaidOrderAmendmentError,
  paidOrderAmendment,
  type VerifiedSettlementAction,
} from '@/lib/paid-order-amendment-api';
import { asyncStorage } from '@/lib/storage';
import { generateUUID } from '@/utils/uuid';
import { PaidOrderSettlementAction } from './PaidOrderSettlementAction';
import { PaidOrderSettlementWorkspaceRecovery } from './PaidOrderSettlementWorkspaceRecovery';
import { PaidOrderVerifiedBankReturn } from './PaidOrderVerifiedBankReturn';
import { PaidOrderVerifiedCancellationSheet } from './PaidOrderVerifiedCancellationSheet';

interface Props {
  orderId: string;
  amendmentId: string;
  operatorId: string;
  verification: AmendmentWorkspace;
  colors: ThemeColors;
  refreshOrder: () => Promise<boolean>;
  workspaceFresh?: boolean;
}
export function PaidOrderVerifiedSettlement({
  orderId,
  amendmentId,
  operatorId,
  verification,
  colors,
  refreshOrder,
  workspaceFresh = true,
}: Props) {
  const client = useQueryClient();
  const {
    pending,
    queryKey: key,
    storageKey,
    unreadableKey,
    unreadableSavedAction,
    unreadableMessage,
    setUnreadableMessage,
    savedAction,
  } = usePaidOrderSettlementPending({ operatorId, orderId, amendmentId });
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [message, setMessage] = useState('');
  const recoveryRequired = unreadableSavedAction || refreshRequired;
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

  function action(
    label: string,
    onPress: () => void,
    disabled = false,
    allowWhenWorkspaceStale = false
  ) {
    return (
      <PaidOrderSettlementAction
        label={label}
        onPress={onPress}
        disabled={disabled}
        busy={busy}
        workspaceFresh={workspaceFresh}
        allowWhenWorkspaceStale={allowWhenWorkspaceStale}
        colors={colors}
      />
    );
  }

  async function submit(payload: VerifiedSettlementAction, retrySaved = false) {
    if (
      inFlight.current ||
      (!workspaceFresh && !retrySaved) ||
      (recoveryRequired && !retrySaved)
    )
      return;
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

  const retrySavedAction = (payload: VerifiedSettlementAction) =>
    action(
      'Retry the same settlement request',
      () => void submit(payload, true),
      false,
      true
    );

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
      <PaidOrderSettlementWorkspaceRecovery
        colors={colors}
        busy={busy}
        pendingReadError={pending.isError}
        unreadableMessage={unreadableMessage}
        recoveryRequired={recoveryRequired}
        workspaceFresh={workspaceFresh}
        showGeneralReload={!cancellation}
        verifiedCancellationPending={Boolean(
          verification.verifiedCancellationPending
        )}
        verifiedCancellationReady={Boolean(
          verification.verifiedCancellationReady
        )}
        onRetryPending={() => void pending.refetch()}
        onReload={() => void reloadOrderStatus()}
      />
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
            disabled={
              busy || !pending.isSuccess || recoveryRequired || !workspaceFresh
            }
            outgoingEvidence={outgoingEvidence}
            setOutgoingEvidence={setOutgoingEvidence}
            onSubmit={(payload) => void submit(payload)}
          />
        )}
      {cancellation && (
        <PaidOrderVerifiedCancellationSheet
          colors={colors}
          closing={closing}
          reason={reason}
          setReason={setReason}
          busy={busy}
          recoveryRequired={recoveryRequired || !workspaceFresh}
          pendingReady={pending.isSuccess && workspaceFresh}
          canOpenVerifiedCancellation={Boolean(
            workspaceFresh && verification.canOpenVerifiedCancellation
          )}
          verifiedCancellationReady={Boolean(
            workspaceFresh && verification.verifiedCancellationReady
          )}
          savedAction={savedAction}
          message={message}
          onConfirm={() =>
            void submit({
              action: cancellation,
              idempotencyKey: generateUUID(),
              reason: reason.trim(),
            })
          }
          onReload={() => void reloadOrderStatus()}
          onClose={() => {
            if (!inFlight.current) setCancellation(null);
          }}
          retrySavedAction={retrySavedAction}
        />
      )}
    </View>
  );
}

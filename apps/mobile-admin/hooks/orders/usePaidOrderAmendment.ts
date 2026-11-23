import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  type AmendmentConfirmation,
  amendmentConfirmationSchema,
  PaidOrderAmendmentError,
  paidOrderAmendment,
} from '@/lib/paid-order-amendment-api';
import { asyncStorage } from '@/lib/storage';
import { AuthenticatedFetchPreflightError } from './authenticated-fetch';

type ConfirmationOutcome = 'confirmed' | 'competing' | 'unknown';

const definitiveReplayConflicts = new Set([
  'already_amended',
  'amendment_ineligible',
  'bank_evidence_conflict',
  'bank_evidence_required',
  'idempotency_conflict',
  'preview_stale',
  'replacement_unavailable',
  'scenario_disabled',
  'staff_pos_receipt_used',
  'tender_evidence_required',
]);

export function usePaidOrderAmendment(
  orderId: string,
  merchantId: string,
  deferWorkspace = false
) {
  const { user } = useAuth();
  const client = useQueryClient();
  const refreshGeneration = useRef(0);
  useEffect(
    () => () => {
      refreshGeneration.current += 1;
    },
    []
  );
  const workspaceKey = ['paid-order-amendment', user?.id, merchantId, orderId];
  const pendingKey = [...workspaceKey, 'pending'];
  const storageKey = workspaceKey.join(':');
  const [pendingUnreadable, setPendingUnreadable] = useState(false);
  const pending = useQuery({
    queryKey: pendingKey,
    queryFn: async () => {
      let saved: string | null;
      try {
        saved = await asyncStorage.getItem(storageKey);
      } catch {
        setPendingUnreadable(true);
        return null;
      }
      if (!saved) {
        setPendingUnreadable(false);
        return null;
      }
      try {
        const parsed = amendmentConfirmationSchema.safeParse(JSON.parse(saved));
        setPendingUnreadable(!parsed.success);
        return parsed.success ? parsed.data : null;
      } catch {
        setPendingUnreadable(true);
        return null;
      }
    },
    enabled: Boolean(user?.id),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const workspace = useQuery({
    queryKey: workspaceKey,
    queryFn: ({ signal }) => paidOrderAmendment.workspace(orderId, signal),
    // An unpaid snapshot can be stale. Preserve saved or known recovery, and
    // check the server if the local recovery state could not be read.
    enabled: (query) =>
      Boolean(
        user?.id &&
          (!deferWorkspace ||
            pending.data ||
            pendingUnreadable ||
            pending.isError ||
            query.state.data?.summary)
      ),
    retry: false,
  });

  async function clearPending() {
    await asyncStorage.removeItem(storageKey);
    client.setQueryData(pendingKey, null);
    setPendingUnreadable(false);
  }

  async function recoverUnreadableConfirmation() {
    if (!pendingUnreadable) {
      throw new Error('There is no unreadable confirmation to recover.');
    }
    if (!(await refreshOrder())) {
      throw new Error('Order status could not be reloaded. Try again.');
    }
    await clearPending();
  }

  async function refreshOrder(): Promise<boolean> {
    const generation = ++refreshGeneration.current;
    void client.invalidateQueries({ queryKey: ['order', orderId, merchantId] });
    void client.invalidateQueries({ queryKey: ['orders', merchantId] });
    void client.invalidateQueries({
      queryKey: ['order-audit-events', orderId, merchantId],
    });
    await client.cancelQueries({ queryKey: workspaceKey, exact: true });
    if (generation !== refreshGeneration.current) return false;
    let unsubscribe: () => void = () => {
      // No listener is active before the subscription is assigned.
    };
    const offline = new Promise<boolean>((resolve) => {
      unsubscribe = onlineManager.subscribe((online) => {
        if (!online) resolve(false);
      });
      if (!onlineManager.isOnline()) resolve(false);
    });
    const refresh = workspace
      .refetch({ throwOnError: true })
      .then((result) => result.isSuccess && !result.isPaused)
      .catch(() => false);
    const succeeded = await Promise.race([refresh, offline]);
    unsubscribe();
    if (!succeeded) return false;
    if (generation === refreshGeneration.current) {
      return true;
    }
    return false;
  }

  async function checkConfirmation(
    payload: AmendmentConfirmation
  ): Promise<ConfirmationOutcome> {
    const current = await paidOrderAmendment.workspace(orderId);
    client.setQueryData(workspaceKey, current);
    if (!current.summary) return 'unknown';
    await clearPending();
    void refreshOrder().catch(() => undefined);
    return current.confirmationKey === payload.idempotencyKey
      ? 'confirmed'
      : 'competing';
  }

  async function confirm(
    payload: AmendmentConfirmation
  ): Promise<ConfirmationOutcome> {
    const wasPending = Boolean(pending.data);
    // Persist before sending so a process restart retains the exact request.
    await asyncStorage.setItem(storageKey, JSON.stringify(payload));
    client.setQueryData(pendingKey, payload);
    try {
      await paidOrderAmendment.confirm(orderId, payload);
    } catch (error) {
      if (
        !wasPending &&
        (error instanceof AuthenticatedFetchPreflightError ||
          (error instanceof PaidOrderAmendmentError &&
            error.status >= 400 &&
            error.status < 500 &&
            error.status !== 408))
      ) {
        await clearPending();
        void refreshOrder().catch(() => undefined);
        throw error;
      }
      const recovered = await checkConfirmation(payload).catch(
        (): ConfirmationOutcome => 'unknown'
      );
      if (recovered !== 'unknown') return recovered;
      // These RPC conflicts follow the idempotency lookup. Losing access
      // and transient errors cannot establish the outcome of an earlier send.
      if (
        error instanceof PaidOrderAmendmentError &&
        error.status === 409 &&
        error.code !== undefined &&
        definitiveReplayConflicts.has(error.code)
      ) {
        await clearPending();
        void refreshOrder().catch(() => undefined);
        throw error;
      }
      return 'unknown';
    }
    await clearPending();
    void refreshOrder().catch(() => undefined);
    return 'confirmed';
  }

  return {
    canStart: Boolean(
      !deferWorkspace &&
        workspace.isSuccess &&
        workspace.data.canStart &&
        pending.isSuccess &&
        !pendingUnreadable
    ),
    canRefund: Boolean(workspace.isSuccess && workspace.data.canRefund),
    summary: workspace.isSuccess ? workspace.data.customer : null,
    verification:
      workspace.isSuccess &&
      workspace.data.isVerifiedFunding &&
      workspace.data.canRefund
        ? workspace.data
        : null,
    operatorId: user?.id,
    refreshOrder,
    pending: pending.data,
    pendingUnreadable,
    recoverUnreadableConfirmation,
    confirm,
    checkConfirmation,
  };
}

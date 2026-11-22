import { useQuery, useQueryClient } from '@tanstack/react-query';
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

export function usePaidOrderAmendment(orderId: string, merchantId: string) {
  const { user } = useAuth();
  const client = useQueryClient();
  const workspaceKey = ['paid-order-amendment', user?.id, merchantId, orderId];
  const pendingKey = [...workspaceKey, 'pending'];
  const storageKey = workspaceKey.join(':');
  const workspace = useQuery({
    queryKey: workspaceKey,
    queryFn: ({ signal }) => paidOrderAmendment.workspace(orderId, signal),
    enabled: Boolean(user?.id),
    retry: false,
  });
  const pending = useQuery({
    queryKey: pendingKey,
    queryFn: async () => {
      const saved = await asyncStorage.getItem(storageKey);
      return saved
        ? amendmentConfirmationSchema.parse(JSON.parse(saved))
        : null;
    },
    enabled: Boolean(user?.id),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  async function clearPending() {
    await asyncStorage.removeItem(storageKey);
    client.setQueryData(pendingKey, null);
  }

  function refreshOrder() {
    void client.invalidateQueries({ queryKey: ['order', orderId, merchantId] });
    void client.invalidateQueries({ queryKey: ['orders', merchantId] });
    void client.invalidateQueries({
      queryKey: ['order-audit-events', orderId, merchantId],
    });
    void client.invalidateQueries({ queryKey: workspaceKey, exact: true });
  }

  async function checkConfirmation(
    payload: AmendmentConfirmation
  ): Promise<ConfirmationOutcome> {
    const current = await paidOrderAmendment.workspace(orderId);
    client.setQueryData(workspaceKey, current);
    if (!current.summary) return 'unknown';
    await clearPending();
    refreshOrder();
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
        refreshOrder();
        throw error;
      }
      const recovered = await checkConfirmation(payload).catch(
        (): ConfirmationOutcome => 'unknown'
      );
      if (recovered !== 'unknown') return recovered;
      if (
        error instanceof PaidOrderAmendmentError &&
        error.code === 'preview_stale'
      ) {
        await clearPending();
        refreshOrder();
        throw error;
      }
      return 'unknown';
    }
    await clearPending();
    refreshOrder();
    return 'confirmed';
  }

  return {
    canStart: Boolean(
      workspace.isSuccess && workspace.data.canStart && pending.isSuccess
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
    confirm,
    checkConfirmation,
  };
}

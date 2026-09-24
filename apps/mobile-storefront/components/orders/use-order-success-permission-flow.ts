import type { RefObject } from 'react';
import { useEffect, useState } from 'react';
import { usePermissionBooster } from '@/hooks/use-permission-booster';

interface OrderSuccessPermissionFlowInput {
  isReconciliation: boolean;
  permissionFlowActiveRef: RefObject<boolean>;
  /**
   * Whether the deferred-order status is authoritative yet. The soft ask
   * waits for it like every other purchase-success side effect: a slow
   * refunded lookup must not open the permission modal for an order that
   * is about to flip to reconciliation.
   */
  statusAuthoritative: boolean;
}

/**
 * Post-order notification soft-ask flow: delayed permission lookup,
 * soft-ask modal state, and grant/deny handlers. Drives the
 * caller-owned flow ref so the post-order interstitial can withhold
 * while the flow is visible or in progress.
 */
export function useOrderSuccessPermissionFlow({
  isReconciliation,
  permissionFlowActiveRef,
  statusAuthoritative,
}: OrderSuccessPermissionFlowInput) {
  const { requestPermission, triggerSystemPrompt, markDenied } =
    usePermissionBooster();
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  // Mirrors permissionFlowActiveRef for render: the soft-ask modal closing
  // on grant does NOT end the flow — the native system prompt is still in
  // flight, and the success banner must stay unmounted underneath it.
  const [isPermissionFlowActive, setPermissionFlowActive] = useState(false);

  useEffect(() => {
    // No soft-ask on reconciliation arrivals: no completed purchase sits
    // behind them. Otherwise wait until the deferred-order status is
    // authoritative before arming the timer.
    if (isReconciliation || !statusAuthoritative) {
      return;
    }
    // Check for notification permissions (Soft Ask)
    // Small delay to let the success animation play (better UX).
    // The flag is set before awaiting the permission lookup: on a slow
    // device the native-module import or status check can still be pending
    // past the interstitial timer, and the ad must not present just as the
    // soft ask opens. Terminal non-modal results clear it immediately.
    const timerId = setTimeout(async () => {
      permissionFlowActiveRef.current = true;
      setPermissionFlowActive(true);
      const result = await requestPermission('notifications');
      if (result === 'soft-ask-needed') {
        setShowPermissionModal(true);
      } else {
        permissionFlowActiveRef.current = false;
        setPermissionFlowActive(false);
      }
    }, 1500);

    return () => {
      clearTimeout(timerId);
    };
    // permissionFlowActiveRef is a stable caller-owned ref: listing it
    // satisfies exhaustive-deps without ever re-arming the timer.
  }, [
    isReconciliation,
    statusAuthoritative,
    permissionFlowActiveRef,
    requestPermission,
  ]);

  const handlePermissionGrant = async () => {
    setShowPermissionModal(false);
    await triggerSystemPrompt('notifications');
    permissionFlowActiveRef.current = false;
    setPermissionFlowActive(false);
  };

  const handlePermissionDeny = () => {
    setShowPermissionModal(false);
    permissionFlowActiveRef.current = false;
    setPermissionFlowActive(false);
    markDenied('notifications');
  };

  return {
    handlePermissionDeny,
    handlePermissionGrant,
    isPermissionFlowActive,
    showPermissionModal,
  };
}

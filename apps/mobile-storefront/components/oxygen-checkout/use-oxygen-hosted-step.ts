import type { OxygenRuntimeSnapshot } from '@baci/shared/oxygen';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import type { OxygenClient } from '@/services/oxygen/client';
import type { OxygenWorkflowController } from '@/services/oxygen/workflow';
import type { OxygenHostedKind } from './oxygen-hosted-navigation';
import { recordOxygenSelfieDiagnostic } from './oxygen-selfie-diagnostics';
import { useOxygenSelfieRenewal } from './use-oxygen-selfie-renewal';

type ApprovedPayment = { workflowId: string; bookingReference: string };

export function useOxygenHostedStep({
  snapshot,
  client,
  controller,
  disabled,
  ready,
  paymentUrl,
  selfieRetryAttempt = 0,
}: {
  snapshot: OxygenRuntimeSnapshot;
  client: OxygenClient;
  controller: OxygenWorkflowController;
  disabled: boolean;
  ready: boolean;
  paymentUrl?: string;
  selfieRetryAttempt?: number;
}) {
  const [hosted, setHosted] = useState<OxygenHostedKind | null>(null);
  const [approvedPayment, openApprovedPayment] =
    useState<ApprovedPayment | null>(null);
  const [paymentOpened, setPaymentOpened] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const requestedAttempt = useRef<number | null>(null);
  const opened = useRef<string | null>(null);
  const lastStatus = useRef<string | null>(null);
  const state = snapshot.state;
  useEffect(() => {
    if (
      !approvedPayment ||
      disabled ||
      !ready ||
      !paymentUrl ||
      snapshot.stage !== 'payment_required' ||
      state.paymentComplete ||
      approvedPayment.workflowId !== snapshot.workflowId ||
      approvedPayment.bookingReference !== state.bookingReference
    )
      return;
    openApprovedPayment(null);
    setPaymentOpened(true);
    setHosted('payment');
  }, [
    approvedPayment,
    disabled,
    ready,
    paymentUrl,
    snapshot.stage,
    snapshot.workflowId,
    state.bookingReference,
    state.paymentComplete,
  ]);
  const renewal = useOxygenSelfieRenewal({
    url: state.selfieUrl,
    enabled:
      hosted === 'selfie' &&
      ready &&
      snapshot.executionEnabled &&
      !state.bookingReference &&
      state.kyc?.selfie_status !== 'DONE',
    blocked: disabled,
    workflowId: snapshot.workflowId,
    client,
    controller,
  });
  useEffect(() => {
    if (
      !disabled &&
      ready &&
      !requesting &&
      state.validated &&
      !state.selfieUrl &&
      !state.bookingReference &&
      state.kyc?.selfie_status !== 'DONE' &&
      requestedAttempt.current !== selfieRetryAttempt
    ) {
      // Only an explicit recovery can start a second request. The controller
      // still checks the canonical snapshot and local dispatch fence first.
      requestedAttempt.current = selfieRetryAttempt;
      setRequesting(true);
      void controller
        .execute({ action: 'selfie_link' })
        .finally(() => setRequesting(false));
    }
  }, [
    disabled,
    ready,
    requesting,
    selfieRetryAttempt,
    state.validated,
    state.selfieUrl,
    state.bookingReference,
    state.kyc?.selfie_status,
    controller,
  ]);
  useEffect(() => {
    if (hosted === 'selfie' && state.kyc?.selfie_status === 'DONE') {
      setHosted(null);
    } else if (
      !disabled &&
      ready &&
      state.validated &&
      state.selfieUrl &&
      state.kyc?.selfie_status !== 'DONE' &&
      opened.current !== state.selfieUrl
    ) {
      opened.current = state.selfieUrl;
      setHosted('selfie');
    }
  }, [
    disabled,
    ready,
    state.validated,
    state.selfieUrl,
    state.kyc?.selfie_status,
    hosted,
  ]);

  async function refresh() {
    if (
      hosted === 'selfie' &&
      !snapshot.pending &&
      snapshot.executionEnabled &&
      state.kyc?.selfie_status !== 'DONE'
    ) {
      let result: Awaited<ReturnType<OxygenClient['selfieStatus']>>;
      try {
        result = await client.selfieStatus(snapshot.workflowId);
      } catch (error) {
        if (lastStatus.current !== 'status_unavailable') {
          lastStatus.current = 'status_unavailable';
          recordOxygenSelfieDiagnostic('status_unavailable');
        }
        throw error;
      }
      const status = result.confirmed ? 'confirmed' : 'pending';
      if (lastStatus.current !== status) {
        lastStatus.current = status;
        recordOxygenSelfieDiagnostic(status);
      }
      // Only the authenticated provider read can advance the persisted KYC.
      // Browser launch or dismissal does not confirm verification.
      if (result.confirmed) await controller.execute({ action: 'refresh_kyc' });
      return;
    }
    await controller.pollHostedStatus();
  }
  function close() {
    setHosted(null);
    if (
      hosted === 'payment' &&
      snapshot.executionEnabled &&
      !snapshot.pending &&
      snapshot.stage === 'payment_required'
    ) {
      void controller.execute({ action: 'refresh_payment_setup' });
    } else {
      void controller.refresh();
    }
  }
  // Native header/swipe Back must dismiss the selfie, not pop the checkout
  // route. The separate native Modal also routes Android system Back here.
  usePreventRemove(hosted === 'selfie', close);
  return {
    hosted,
    requesting,
    renewal,
    open: (kind: OxygenHostedKind) => {
      if (kind === 'payment') {
        openApprovedPayment(null);
        setPaymentOpened(true);
      }
      setHosted(kind);
    },
    openApprovedPayment,
    paymentOpened,
    refresh,
    close,
  };
}

import type { OxygenRuntimeSnapshot } from '@baci/shared/oxygen';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import type { OxygenClient } from '@/services/oxygen/client';
import type { OxygenWorkflowController } from '@/services/oxygen/workflow';
import type { OxygenHostedKind } from './oxygen-hosted-navigation';
import { recordOxygenSelfieDiagnostic } from './oxygen-selfie-diagnostics';
import { useOxygenSelfieRenewal } from './use-oxygen-selfie-renewal';

export function useOxygenHostedStep({
  snapshot,
  client,
  controller,
  disabled,
  ready,
}: {
  snapshot: OxygenRuntimeSnapshot;
  client: OxygenClient;
  controller: OxygenWorkflowController;
  disabled: boolean;
  ready: boolean;
}) {
  const [hosted, setHosted] = useState<OxygenHostedKind | null>(null);
  const [requesting, setRequesting] = useState(false);
  const requested = useRef(false);
  const opened = useRef<string | null>(null);
  const lastStatus = useRef<string | null>(null);
  const state = snapshot.state;
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
      state.validated &&
      !state.selfieUrl &&
      !state.bookingReference &&
      state.kyc?.selfie_status !== 'DONE' &&
      !requested.current
    ) {
      requested.current = true;
      setRequesting(true);
      void controller
        .execute({ action: 'selfie_link' })
        .finally(() => setRequesting(false));
    }
  }, [
    disabled,
    ready,
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
      // WebView messages/navigation and OS camera permission cannot confirm it.
      if (result.confirmed) await controller.execute({ action: 'refresh_kyc' });
      return;
    }
    await controller.refresh();
  }
  function close() {
    setHosted(null);
    void controller.refresh();
  }
  // Native header/swipe Back must dismiss the selfie, not pop the checkout
  // route. The separate native Modal also routes Android system Back here.
  usePreventRemove(hosted === 'selfie', close);
  return {
    hosted,
    requesting,
    renewal,
    open: setHosted,
    refresh,
    close,
  };
}

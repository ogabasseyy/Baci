import { cleanup, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import {
  OxygenSelfieConfirmedContext,
  OxygenSelfieSurfaceContext,
} from './OxygenPaymentSurfaceContext';
import { useOxygenSelfieHandoff } from './use-oxygen-selfie-handoff';

afterEach(cleanup);
const snapshot: OxygenRuntimeSnapshot = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  stage: 'kyc_required',
  version: 1,
  environment: 'staging',
  executionEnabled: true,
  state: {
    validated: true,
    selfieUrl: 'https://staging.d1l1k5yxed9cvn.amplifyapp.com/?token=test',
  },
  approvalOtpReady: false,
  checkoutPhone: '',
  checkoutAddress: {},
  activationEnabled: false,
  settlementEnabled: false,
};
it('opens automatically only after OTP succeeds and once per saved link', () => {
  const open = vi.fn();
  const submit = vi.fn();
  const refresh = vi.fn();
  const wrapper = ({ children }: PropsWithChildren) => (
    <OxygenSelfieSurfaceContext.Provider value={open}>
      {children}
    </OxygenSelfieSurfaceContext.Provider>
  );
  const view = renderHook(
    ({ state }: { state: OxygenRuntimeSnapshot }) =>
      useOxygenSelfieHandoff(state, true, false, submit, refresh),
    {
      initialProps: {
        state: {
          ...snapshot,
          state: { ...snapshot.state, validated: false },
        } as OxygenRuntimeSnapshot,
      },
      wrapper,
    }
  );
  expect(open).not.toHaveBeenCalled();
  view.rerender({ state: snapshot });
  expect(open).toHaveBeenCalledWith(
    snapshot.state.selfieUrl,
    snapshot.workflowId
  );
  view.rerender({ state: { ...snapshot } });
  expect(open).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
});
it('returns to the saved application without reconciling or retrying the NIN hold', () => {
  const open = vi.fn();
  const submit = vi.fn();
  const refresh = vi.fn();
  const wrapper = ({ children }: PropsWithChildren) => (
    <OxygenSelfieSurfaceContext.Provider value={open}>
      <OxygenSelfieConfirmedContext.Provider value={snapshot.workflowId}>
        {children}
      </OxygenSelfieConfirmedContext.Provider>
    </OxygenSelfieSurfaceContext.Provider>
  );
  renderHook(
    () =>
      useOxygenSelfieHandoff(
        {
          ...snapshot,
          stage: 'reconciliation_required',
          pending: {
            action: 'validate_nin',
            status: 'indeterminate',
            idempotencyKey: snapshot.workflowId,
          },
        },
        true,
        false,
        submit,
        refresh
      ),
    { wrapper }
  );
  expect(open).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledOnce();
});
it('refreshes KYC after confirmed selfie in an unblocked workflow, never NIN', () => {
  const submit = vi.fn();
  const refresh = vi.fn();
  const wrapper = ({ children }: PropsWithChildren) => (
    <OxygenSelfieConfirmedContext.Provider value={snapshot.workflowId}>
      {children}
    </OxygenSelfieConfirmedContext.Provider>
  );
  renderHook(
    () => useOxygenSelfieHandoff(snapshot, true, false, submit, refresh),
    { wrapper }
  );
  expect(submit).toHaveBeenCalledWith({ action: 'refresh_kyc' });
  expect(submit).toHaveBeenCalledOnce();
});

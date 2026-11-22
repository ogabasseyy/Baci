import { oxygenRuntimeSnapshotSchema } from '@baci/shared/oxygen';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import type { OxygenWorkflowController } from '@/services/oxygen/workflow';
import { OxygenWorkflowBody } from './OxygenWorkflowBody';

jest.mock('./OxygenApplicationFlow', () => ({
  OxygenApplicationFlow: () => null,
}));
jest.mock('./use-oxygen-hosted-step', () => ({
  useOxygenHostedStep: () => ({ hosted: null, requesting: false, renewal: {} }),
}));
jest.mock('./use-oxygen-initial-nin', () => ({
  useOxygenInitialNin: () => false,
}));
jest.mock('./use-oxygen-phone-marker', () => ({
  useOxygenPhoneMarker: () => ({ sentAt: null, mark: jest.fn() }),
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

const snapshot = oxygenRuntimeSnapshotSchema.parse({
  workflowId: '11111111-1111-4111-8111-111111111111',
  version: 4,
  stage: 'eligibility_required',
  environment: 'staging',
  executionEnabled: true,
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
  state: {
    validated: true,
    kyc: {
      phone_status: 'DONE',
      bvn_status: 'DONE',
      selfie_status: 'DONE',
      nin_status: 'NOT_DONE',
      bank_status: 'NOT_DONE',
      address_status: 'NOT_DONE',
    },
  },
});

it('does not retry eligibility from a checkout screen hidden behind another route', async () => {
  jest.useFakeTimers();
  try {
    const execute = jest.fn().mockResolvedValue(undefined);
    const controller = {
      execute,
      getState: () => ({ error: null }),
    } as unknown as OxygenWorkflowController;
    const props = {
      snapshot,
      client: {} as OxygenClient,
      controller,
      capabilities: null,
      busy: false,
      productAmount: 198000,
      scopeKey: 'focus-test',
      onViewOrders: jest.fn(),
    };
    const screen = render(<OxygenWorkflowBody {...props} focused={false} />);
    await act(async () => {});
    expect(execute).not.toHaveBeenCalled();

    screen.rerender(<OxygenWorkflowBody {...props} focused />);
    await act(async () => {});
    expect(execute).toHaveBeenCalledTimes(1);

    const pending = {
      ...snapshot,
      state: { ...snapshot.state, eligibilityStatus: 'pending' as const },
    };
    screen.rerender(
      <OxygenWorkflowBody {...props} snapshot={pending} focused />
    );
    screen.rerender(
      <OxygenWorkflowBody {...props} snapshot={pending} focused={false} />
    );
    await act(async () => {
      jest.advanceTimersByTime(40000);
    });
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

it('lets a saved payment checkpoint reconcile without reopening the hosted payment', async () => {
  const execute = jest.fn().mockResolvedValue(undefined);
  const controller = {
    execute,
    getState: () => ({ error: null }),
  } as unknown as OxygenWorkflowController;
  const view = render(
    <OxygenWorkflowBody
      snapshot={{
        ...snapshot,
        stage: 'ready_for_activation',
        state: {
          ...snapshot.state,
          paymentComplete: true,
          setupComplete: true,
        },
      }}
      client={{} as OxygenClient}
      controller={controller}
      capabilities={null}
      busy={false}
      focused
      productAmount={198000}
      scopeKey="checkpoint-test"
      onViewOrders={jest.fn()}
    />
  );

  expect(view.queryByRole('button', { name: 'Continue payment' })).toBeNull();
  await act(async () => {
    fireEvent.press(view.getByRole('button', { name: 'Check payment status' }));
  });
  expect(execute).toHaveBeenCalledWith({ action: 'refresh_payment_setup' });
});

import type { OxygenRuntimeSnapshot } from '@baci/shared/oxygen';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import type { OxygenWorkflowController } from '@/services/oxygen/workflow';
import { OxygenApprovalFlow } from './OxygenApprovalFlow';

jest.mock('./OxygenBreakdown', () => ({
  OxygenBreakdown: ({ onAccept }: { onAccept: () => void }) => {
    const { Text } = require('react-native');
    return <Text onPress={onAccept}>Accept breakdown</Text>;
  },
}));
jest.mock('./OxygenSignatureStep', () => ({
  OxygenSignatureStep: ({
    nextPaymentDate,
    termsKey,
    onSignature,
    onAccept,
    onContinue,
    requestingCode,
  }: {
    nextPaymentDate?: string;
    termsKey: string;
    onSignature: (file: unknown, key: string) => void;
    onAccept: (value: boolean) => void;
    onContinue: () => void;
    requestingCode?: boolean;
  }) => {
    const { Text } = require('react-native');
    return (
      <>
        <Text>Confirmed next payment {nextPaymentDate}</Text>
        <Text
          onPress={() => {
            onSignature(
              {
                name: 'signature.png',
                type: 'image/png',
                bytes: new Uint8Array([1]),
              },
              termsKey
            );
            onAccept(true);
          }}
        >
          Sign test
        </Text>
        <Text onPress={onContinue}>
          {requestingCode ? 'Sending code…' : 'Continue signature'}
        </Text>
      </>
    );
  },
}));
jest.mock('./OxygenOtp', () => ({
  OxygenOtp: () => {
    const { Text } = require('react-native');
    return <Text>OTP view</Text>;
  },
}));
jest.mock('./oxygen-presentation', () => ({
  OxygenAction: ({
    label,
    onPress,
  }: {
    label: string;
    onPress: () => void;
  }) => {
    const { Text } = require('react-native');
    return <Text onPress={onPress}>{label}</Text>;
  },
}));
it('provides the server-confirmed repayment date needed to accept the signature plan', async () => {
  const snapshot = {
    workflowId: 'workflow',
    version: 2,
    stage: 'approval_required',
    executionEnabled: true,
    state: {
      booking: {
        loan_reference: 'booking',
        total_upfront_payment: 25000,
        first_repayment: 10000,
        total_charges: 1000,
      },
      schedule: [{ period: 1, dueDate: [2027, 1, 5], amount: 10000 }],
    },
  } as OxygenRuntimeSnapshot;
  render(
    <OxygenApprovalFlow
      snapshot={snapshot}
      client={{} as OxygenClient}
      controller={{} as OxygenWorkflowController}
      busy={false}
    />
  );
  fireEvent.press(screen.getByText('Accept breakdown'));
  expect(screen.getByText('Confirmed next payment 2027-1-5')).toBeTruthy();
});

it('keeps the signature until the code is ready and restores it when going back', async () => {
  const snapshot = {
    workflowId: 'workflow',
    version: 26,
    stage: 'approval_required',
    executionEnabled: true,
    state: {
      booking: {
        loan_reference: 'booking',
        total_upfront_payment: 25000,
        total_charges: 1000,
      },
      schedule: [{ period: 1, dueDate: [2027, 1, 5], amount: 10000 }],
    },
  } as OxygenRuntimeSnapshot;
  const execute = jest.fn().mockResolvedValue(undefined);
  const now = Date.now();
  const result = {
    window: {
      bookingReference: 'booking',
      sentAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 300000).toISOString(),
    },
  };
  let confirm: (value: typeof result) => void = () => undefined;
  const approvalWindow = jest
    .fn()
    .mockResolvedValueOnce({ window: null })
    .mockImplementationOnce(
      () =>
        new Promise<typeof result>((resolve) => {
          confirm = resolve;
        })
    );
  render(
    <OxygenApprovalFlow
      snapshot={snapshot}
      client={{ approvalWindow } as unknown as OxygenClient}
      controller={
        {
          execute,
          getState: () => ({ snapshot, error: null }),
        } as unknown as OxygenWorkflowController
      }
      busy={false}
    />
  );
  fireEvent.press(screen.getByText('Accept breakdown'));
  fireEvent.press(screen.getByText('Sign test'));
  fireEvent.press(screen.getByText('Continue signature'));
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(screen.getByText('Confirmed next payment 2027-1-5')).toBeTruthy();
  expect(screen.getByText('Sending code…')).toBeTruthy();
  expect(screen.queryByText('Preparing your verification code…')).toBeNull();
  expect(screen.queryByText('OTP view')).toBeNull();

  await act(async () => confirm(result));
  expect(screen.getByText('OTP view')).toBeTruthy();
  expect(screen.queryByText('Confirmed next payment 2027-1-5')).toBeNull();
  fireEvent.press(screen.getByText('Back to signature'));
  expect(screen.getByText('Confirmed next payment 2027-1-5')).toBeTruthy();
});

it('automatically loads a missing saved repayment breakdown once', async () => {
  const snapshot = {
    workflowId: 'workflow',
    version: 23,
    stage: 'approval_required',
    executionEnabled: true,
    pending: null,
    state: {
      bookingReference: 'booking',
      booking: {
        loan_reference: 'booking',
        equity_amount: 49500,
        loan_amount: 148500,
        loan_tenure: 3,
        status: 'BOOKED',
      },
    },
  } as OxygenRuntimeSnapshot;
  const execute = jest.fn().mockResolvedValue(undefined);
  const controller = {
    execute,
    getState: () => ({ error: null }),
  } as unknown as OxygenWorkflowController;
  const { rerender } = render(
    <OxygenApprovalFlow
      snapshot={snapshot}
      client={{} as OxygenClient}
      controller={controller}
      busy={false}
    />
  );
  await waitFor(() =>
    expect(execute).toHaveBeenCalledWith({ action: 'refresh_details' })
  );
  rerender(
    <OxygenApprovalFlow
      snapshot={snapshot}
      client={{} as OxygenClient}
      controller={controller}
      busy={false}
    />
  );
  expect(execute).toHaveBeenCalledTimes(1);
});

it('uses Oxygen schedule and quoted charges when booking omits repayment totals', async () => {
  const snapshot = {
    workflowId: 'workflow',
    version: 24,
    stage: 'approval_required',
    executionEnabled: true,
    state: {
      bookingReference: 'booking',
      booking: {
        loan_reference: 'booking',
        equity_amount: 49500,
        loan_amount: 148500,
        loan_tenure: 3,
        status: 'BOOKED',
      },
      quotedCharges: 2932.88,
      schedule: [
        { period: 1, dueDate: [2027, 1, 5], amount: 55658 },
        { period: 2, dueDate: [2027, 2, 5], amount: 55658 },
        { period: 3, dueDate: [2027, 3, 5], amount: 55658.39 },
      ],
    },
  } as OxygenRuntimeSnapshot;
  const client = {
    approvalWindow: jest.fn().mockResolvedValue({ window: null }),
  } as unknown as OxygenClient;
  render(
    <OxygenApprovalFlow
      snapshot={snapshot}
      client={client}
      controller={{} as OxygenWorkflowController}
      busy={false}
    />
  );
  await waitFor(() =>
    expect(screen.getByText('Accept breakdown')).toBeTruthy()
  );
});

it('offers an explicit retry if the provider returns no usable breakdown', async () => {
  const snapshot = {
    workflowId: 'workflow',
    stage: 'approval_required',
    executionEnabled: true,
    state: {
      bookingReference: 'booking',
      booking: { loan_reference: 'booking' },
    },
  } as OxygenRuntimeSnapshot;
  const execute = jest.fn().mockResolvedValue(undefined);
  const controller = {
    execute,
    getState: () => ({ error: null }),
  } as unknown as OxygenWorkflowController;
  render(
    <OxygenApprovalFlow
      snapshot={snapshot}
      client={{} as OxygenClient}
      controller={controller}
      busy={false}
    />
  );
  await waitFor(() => expect(screen.getByText('Try again')).toBeTruthy());
  fireEvent.press(screen.getByText('Try again'));
  expect(execute).toHaveBeenCalledTimes(2);
});

it('uses the confirmed schedule instead of a conflicting booking repayment field', async () => {
  const { confirmedOxygenTerms } = await import('./oxygen-confirmed-terms');
  const snapshot = {
    state: {
      booking: {
        loan_reference: 'booking',
        equity_amount: 49500,
        first_repayment: 52432.88,
      },
      quotedCharges: 2932.88,
      schedule: [{ period: 1, dueDate: [2027, 1, 5], amount: 55442 }],
    },
  } as unknown as OxygenRuntimeSnapshot;
  expect(confirmedOxygenTerms(snapshot)).toMatchObject({
    upfront: 52432.88,
    monthly: 55442,
    charges: 2932.88,
  });
});

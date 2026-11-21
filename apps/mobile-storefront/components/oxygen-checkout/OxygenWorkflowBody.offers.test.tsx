import { oxygenRuntimeSnapshotSchema } from '@baci/shared/oxygen';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import type { OxygenWorkflowController } from '@/services/oxygen/workflow';
import { OxygenWorkflowBody } from './OxygenWorkflowBody';

jest.mock('./OxygenApplicationFlow', () => ({
  OxygenApplicationFlow: () => null,
}));
jest.mock('./use-oxygen-hosted-step', () => ({
  useOxygenHostedStep: () => ({
    hosted: null,
    requesting: false,
    renewal: {},
    open: jest.fn(),
    refresh: jest.fn(),
    close: jest.fn(),
  }),
}));
jest.mock('./use-oxygen-eligibility-progress', () => ({
  useOxygenEligibilityProgress: () => ({ delayed: false }),
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

const makeSnapshot = (offers?: { tenure: number; loanAmount: number }[]) =>
  oxygenRuntimeSnapshotSchema.parse({
    workflowId: '11111111-1111-4111-8111-111111111111',
    stage: 'plan_required',
    version: 1,
    environment: 'staging',
    executionEnabled: true,
    state: {
      eligibleAmount: 189000,
      minimumAmount: 68000,
      maxTenure: 3,
      ...(offers ? { offers } : {}),
    },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  });
const execute = jest.fn().mockResolvedValue(undefined);
const controller = {
  execute,
  getState: () => ({ error: null }),
} as unknown as OxygenWorkflowController;
const client = {} as OxygenClient;

it('refreshes missing legacy offers instead of presenting an unsafe plan', () => {
  execute.mockClear();
  render(
    <OxygenWorkflowBody
      focused
      onViewOrders={jest.fn()}
      snapshot={makeSnapshot()}
      client={client}
      controller={controller}
      capabilities={null}
      busy={false}
      productAmount={198000}
      scopeKey="test"
    />
  );
  expect(
    screen.queryByRole('button', { name: 'See payment breakdown' })
  ).toBeNull();
  fireEvent.press(
    screen.getByRole('button', { name: 'Update payment options' })
  );
  expect(execute).toHaveBeenCalledWith({ action: 'refresh_eligibility' });
});
it('blocks a shorter period until the down payment covers its limit', () => {
  execute.mockClear();
  render(
    <OxygenWorkflowBody
      focused
      onViewOrders={jest.fn()}
      snapshot={makeSnapshot([
        { tenure: 1, loanAmount: 68000 },
        { tenure: 2, loanAmount: 131000 },
        { tenure: 3, loanAmount: 189000 },
      ])}
      client={client}
      controller={controller}
      capabilities={null}
      busy={false}
      productAmount={198000}
      scopeKey="test"
    />
  );
  fireEvent.press(screen.getByRole('button', { name: '2 months' }));
  expect(
    screen.getByRole('button', { name: 'See payment breakdown' }).props
      .accessibilityState.disabled
  ).toBe(true);
  fireEvent.press(screen.getByRole('button', { name: '50%' }));
  fireEvent.press(
    screen.getByRole('button', { name: 'See payment breakdown' })
  );
  expect(execute).toHaveBeenCalledWith({
    action: 'book',
    equityPercentage: 50,
    tenure: 2,
  });
});

it('updates missing saved offers before opening approval for an existing booking', () => {
  const current = makeSnapshot();
  const saved = oxygenRuntimeSnapshotSchema.parse({
    ...current,
    stage: 'approval_required',
    state: {
      ...current.state,
      validated: true,
      applicationReference: current.workflowId,
      bookingReference: current.workflowId,
      kyc: {
        phone_status: 'DONE',
        bvn_status: 'DONE',
        selfie_status: 'DONE',
        nin_status: 'DONE',
        bank_status: 'DONE',
        address_status: 'DONE',
      },
      booking: {
        loan_reference: current.workflowId,
        loan_amount: 148500,
        product_amount: 198000,
        equity_percentage: 25,
        equity_amount: 49500,
        loan_tenure: 3,
        status: 'BOOKED',
      },
    },
  });
  execute.mockClear();
  render(
    <OxygenWorkflowBody
      focused
      onViewOrders={jest.fn()}
      snapshot={saved}
      client={client}
      controller={controller}
      capabilities={null}
      busy={false}
      productAmount={198000}
      scopeKey="test"
    />
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Update payment options' })
  );
  expect(execute).toHaveBeenCalledWith({ action: 'refresh_eligibility' });
});

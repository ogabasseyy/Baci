import {
  piggyvestPurchaseSchemas,
  piggyvestSavingsScreenSchema,
} from '@baci/shared/contracts';
import {
  createPiggyvestCancellationController,
  createPiggyvestDeviceChangeController,
  createPiggyvestDraftClosureController,
  createPiggyvestPurchaseController,
  createPiggyvestScheduleController,
} from '@baci/shared/lib';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { deviceChangeFixture } from '../../../../../packages/shared/src/test-fixtures/piggyvest-device-change';
import { purchaseFixture } from '../../../../../packages/shared/src/test-fixtures/piggyvest-purchase';
import { StartSavingsScreen } from './StartSavingsScreen';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('./use-start-savings-controller', () => ({
  useStartSavingsController: () => {
    throw new Error('Legacy must not mount');
  },
}));
jest.mock('./StartSavingsForm', () => ({ StartSavingsForm: () => null }));
jest.mock('./StartSavingsModals', () => ({ StartSavingsModals: () => null }));

async function setup() {
  const fixture = purchaseFixture();
  const device = deviceChangeFixture();
  const source = piggyvestSavingsScreenSchema.parse(fixture.source);
  const identity = {
    source,
    tenantKey: 'synthetic',
    operationId: fixture.operationId,
    isCurrent: () => true,
  };
  const purchase = createPiggyvestPurchaseController({
    ...identity,
    client: {
      quote: async () =>
        piggyvestPurchaseSchemas.published.parse(fixture.published),
      prepare: async () =>
        piggyvestPurchaseSchemas.receipt.parse(fixture.receipt),
      status: async () => piggyvestPurchaseSchemas.status.parse(fixture.status),
    },
  });
  await purchase.quote(fixture.selection);
  const cancellation = createPiggyvestCancellationController({
    ...identity,
    prepare: async () => undefined,
    quote: {
      status: 'quote_available',
      goalId: fixture.goalId,
      revisionId: fixture.operationId,
      termsVersion: 'synthetic',
      termsHash: 'a'.repeat(64),
      consentVersion: '2026-09-11',
      principalKobo: 10000,
      paidInterestKobo: 0,
      pendingInterestKobo: 0,
      interestDisposition: 'unresolved',
      dispatch: 'contract_gap',
    },
  });
  const close = jest.fn<Promise<unknown>, []>(async () => undefined);
  const closure = createPiggyvestDraftClosureController({
    ...identity,
    close,
    read: async () => ({
      status: 'available',
      action: 'close_plan',
      goalId: fixture.goalId,
      revisionId: fixture.operationId,
      termsVersion: 'synthetic',
      termsHash: 'a'.repeat(64),
    }),
  });
  await closure.refresh();
  let version = 0;
  const scheduleSubmit = jest.fn(async () => ({
    status: 'persisted_proposal',
    goalId: fixture.goalId,
    dispatch: 'disabled',
    debitPermission: false,
    receipt: {
      operationId: fixture.operationId,
      state: { version: ++version, status: 'paused', consentProposal: null },
      persisted: true,
      dispatch: 'disabled',
      debitPermission: false,
    },
  }));
  const schedule = createPiggyvestScheduleController({
    ...identity,
    nextOperationId: () => fixture.operationId,
    submit: scheduleSubmit,
    read: async () => ({
      status: 'available',
      goalId: fixture.goalId,
      revisionId: fixture.operationId,
      termsHash: 'a'.repeat(64),
      state: { version, status: 'paused', consentProposal: null },
      historical: null,
      dispatch: 'disabled',
      debitPermission: false,
    }),
  });
  await schedule.refresh();
  const change = createPiggyvestDeviceChangeController({
    ...identity,
    client: {
      quote: async () => device.published,
      confirm: async () => device.receipt,
      status: async () => device.historical,
    },
  });
  await change.quote(device.selection);
  render(
    <StartSavingsScreen
      staging={{
        environment: 'staging',
        source,
        goalId: fixture.goalId,
        sessionKey: fixture.source.sessionKey,
        onAccept: async () => undefined,
        purchaseBinding: purchase,
        cancellation,
        scheduleBinding: schedule,
        deviceChangeBinding: change,
        draftClosureBinding: closure,
      }}
    />
  );
  return { close, scheduleSubmit, schedule, source, closure };
}

it('mounts all five actual controllers without recursive guard reads and blocks siblings when device change starts', async () => {
  const { close, scheduleSubmit } = await setup();
  expect(screen.getAllByRole('checkbox')).toHaveLength(5);
  expect(
    screen.getByRole('button', { name: 'Prepare cancellation' })
  ).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Close plan' })).toBeOnTheScreen();
  fireEvent.press(
    screen.getByRole('checkbox', { name: 'Accept exact device change' })
  );
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Confirm device change' })
    );
  });
  expect(
    screen.getByRole('button', { name: 'Prepare purchase' })
  ).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'Prepare cancellation' })
  ).toBeNull();
  expect(screen.getByRole('button', { name: 'Close plan' })).toBeDisabled();
  expect(close).not.toHaveBeenCalled();
  expect(scheduleSubmit).toHaveBeenCalledTimes(1);
  expect(
    screen.getByText('Funding details are unavailable.')
  ).toBeOnTheScreen();
});

it('keeps schedule mounted while closure is pending and preserves closure recovery after acknowledgement loss', async () => {
  const { close, scheduleSubmit, schedule, source, closure } = await setup();
  let reject: ((reason: Error) => void) | undefined;
  close.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  fireEvent.press(
    screen.getByText('I confirm closing this unfunded draft under these terms.')
  );
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Close plan' }));
  });
  expect(close).toHaveBeenCalledTimes(1);
  expect(schedule.read(source)).not.toBeNull();
  expect(
    screen.getByRole('button', { name: 'Save resume proposal' })
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Refresh schedule review' })
  ).toBeOnTheScreen();
  await act(async () => {
    reject?.(new Error('Lost acknowledgement'));
  });
  expect(
    screen.getByRole('button', { name: 'Refresh plan closure' })
  ).not.toBeDisabled();
  expect(closure.read(source)?.status).toBe('uncertain');
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh plan closure' })
    );
  });
  expect(close).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Close plan' })).toBeNull();
  expect(scheduleSubmit).toHaveBeenCalledTimes(1);
});

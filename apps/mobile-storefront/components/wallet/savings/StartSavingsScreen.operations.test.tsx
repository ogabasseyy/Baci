import {
  piggyvestPurchaseSchemas,
  piggyvestSavingsScreenSchema,
} from '@baci/shared/contracts';
import {
  createPiggyvestCancellationController,
  createPiggyvestPurchaseController,
  createPiggyvestScheduleController,
} from '@baci/shared/lib';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { purchaseFixture } from '../../../../../packages/shared/src/test-fixtures/piggyvest-purchase';
import { StartSavingsScreen } from './StartSavingsScreen';

function capturePress(name: string) {
  let node = screen.getByRole('button', { name });
  while (typeof node.props.onPress !== 'function') {
    if (!node.parent) throw new Error('No press handler');
    node = node.parent;
  }
  const handler: () => Promise<unknown> = node.props.onPress;
  return handler;
}

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
  const source = piggyvestSavingsScreenSchema.parse(fixture.source);
  const purchasePrepare = jest.fn(async () =>
    piggyvestPurchaseSchemas.receipt.parse(fixture.receipt)
  );
  const purchaseBinding = createPiggyvestPurchaseController({
    source,
    tenantKey: 'synthetic',
    operationId: fixture.operationId,
    isCurrent: () => true,
    client: {
      quote: async () =>
        piggyvestPurchaseSchemas.published.parse(fixture.published),
      prepare: purchasePrepare,
      status: async () => piggyvestPurchaseSchemas.status.parse(fixture.status),
    },
  });
  await purchaseBinding.quote(fixture.selection);
  const cancelPrepare = jest.fn(async () => {
    throw new Error('Lost synthetic response');
  });
  const cancellation = createPiggyvestCancellationController({
    source,
    tenantKey: 'synthetic',
    operationId: fixture.goalId,
    isCurrent: () => true,
    prepare: cancelPrepare,
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
  const staging = {
    environment: 'staging' as const,
    goalId: fixture.goalId,
    sessionKey: fixture.source.sessionKey,
    source,
    onAccept: async () => undefined,
    purchaseBinding,
    cancellation,
  };
  return { fixture, staging, purchasePrepare, cancelPrepare };
}

it('a purchase handler captured before same-tick cancellation cannot prepare after cancellation becomes pending/unknown', async () => {
  const { staging, purchasePrepare } = await setup();
  render(<StartSavingsScreen staging={staging} />);
  fireEvent.press(
    screen.getByRole('checkbox', { name: 'Confirm exact purchase quote' })
  );
  const captured = capturePress('Prepare purchase');
  const cancelView = staging.cancellation.read(staging.source);
  if (cancelView?.status !== 'review') throw new Error('fixture');
  await act(async () => {
    const cancellation = staging.cancellation
      .prepare(cancelView.command)
      .catch(() => undefined);
    await captured();
    await cancellation;
  });
  expect(purchasePrepare).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Prepare purchase' })
  ).toBeDisabled();
});

it('a cancellation handler captured before same-tick purchase cannot prepare after purchase becomes pending', async () => {
  const { staging, cancelPrepare } = await setup();
  render(<StartSavingsScreen staging={staging} />);
  fireEvent.press(
    screen.getByRole('checkbox', { name: /I accept cancellation preparation/ })
  );
  const captured = capturePress('Prepare cancellation');
  const purchaseView = staging.purchaseBinding.read(staging.source);
  if (purchaseView?.status !== 'review') throw new Error('fixture');
  await act(async () => {
    const purchase = staging.purchaseBinding.prepare(purchaseView.command);
    await captured();
    await purchase;
  });
  expect(cancelPrepare).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('button', { name: 'Prepare cancellation' })
  ).toBeNull();
});

it('an invalid present schedule blocks purchase and cancellation without mounting legacy', async () => {
  const { staging, purchasePrepare, cancelPrepare } = await setup();
  render(
    <StartSavingsScreen staging={{ ...staging, scheduleBinding: null }} />
  );
  expect(
    screen.getByRole('button', { name: 'Prepare purchase' })
  ).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'Prepare cancellation' })
  ).toBeNull();
  expect(purchasePrepare).not.toHaveBeenCalled();
  expect(cancelPrepare).not.toHaveBeenCalled();
});

it.each([
  'purchase',
  'schedule',
] as const)('blocks a retained competing action when %s starts before rerender', async (first) => {
  const { staging, fixture, purchasePrepare } = await setup();
  let version = 0;
  let sequence = 0;
  const submit = jest.fn(async () => ({
    status: 'persisted_proposal',
    goalId: fixture.goalId,
    dispatch: 'disabled',
    debitPermission: false,
    receipt: {
      operationId: fixture.goalId,
      state: { version: ++version, status: 'paused', consentProposal: null },
      persisted: true,
      dispatch: 'disabled',
      debitPermission: false,
    },
  }));
  const scheduleBinding = createPiggyvestScheduleController({
    source: staging.source,
    tenantKey: 'synthetic',
    isCurrent: () => true,
    nextOperationId: () =>
      ++sequence === 1 ? fixture.goalId : fixture.operationId,
    submit,
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
  await scheduleBinding.refresh();
  render(<StartSavingsScreen staging={{ ...staging, scheduleBinding }} />);
  fireEvent.press(
    screen.getByRole('checkbox', { name: 'Confirm exact purchase quote' })
  );
  fireEvent.press(screen.getByText(/^I request a saved resume proposal/));
  const purchase = capturePress('Prepare purchase');
  const resume = capturePress('Save resume proposal');
  const review = staging.purchaseBinding.read(staging.source);
  if (review?.status !== 'review') throw new Error('fixture');
  if (first === 'purchase') {
    await act(async () => {
      const pending = staging.purchaseBinding.prepare(review.command);
      await resume();
      await pending;
    });
    expect(submit).toHaveBeenCalledTimes(1);
  } else {
    submit.mockImplementationOnce(async () => {
      throw new Error('unknown');
    });
    await act(async () => {
      const pending = scheduleBinding.pause().catch(() => undefined);
      await purchase();
      await pending;
    });
    expect(purchasePrepare).not.toHaveBeenCalled();
  }
});

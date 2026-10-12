import { submitSavingsCardContribution } from '@/lib/savings-card-contributions';
import { sendSavingsCardContributionSnapshot } from './send-savings-card-contribution';

jest.mock('@/lib/savings-card-contributions', () => ({
  submitSavingsCardContribution: jest.fn(),
}));

const snapshot = {
  goalId: 'goal-1',
  savedMethodId: 'method-1',
  amountKobo: 10000,
  idempotencyKey: 'key-1',
  consent: {
    version: 'prefunded-card-v1' as const,
    oneTimeCharge: true as const,
  },
};

function setup(overrides: Record<string, unknown> = {}) {
  const busyRef = { current: false };
  const controllers = new Set<AbortController>();
  const setters = {
    setAllowRetry: jest.fn(),
    setBusy: jest.fn(),
    setMessage: jest.fn(),
    setReviewing: jest.fn(),
  };
  const readStatus = jest.fn().mockResolvedValue(undefined);
  const args = {
    activation: 1,
    busyRef,
    controllers,
    goalId: 'goal-1',
    isCurrent: () => true,
    readStatus,
    reserved: false,
    snapshot,
    ...setters,
    ...overrides,
  };
  return { args, busyRef, controllers, readStatus, setters };
}

beforeEach(() => jest.clearAllMocks());

it('submits the snapshot and polls status on success', async () => {
  const { args, readStatus, setters } = setup();

  await sendSavingsCardContributionSnapshot(args);

  expect(submitSavingsCardContribution).toHaveBeenCalledWith({
    request: snapshot,
    signal: expect.any(AbortSignal),
  });
  expect(readStatus).toHaveBeenCalledWith(snapshot, true, 1);
  expect(setters.setReviewing).toHaveBeenCalledWith(false);
  expect(setters.setAllowRetry).toHaveBeenCalledWith(false);
  expect(setters.setAllowRetry).not.toHaveBeenCalledWith(true);
});

it('refuses to send while busy without a reservation', async () => {
  const { args, readStatus } = setup();
  args.busyRef.current = true;

  await sendSavingsCardContributionSnapshot(args);

  expect(submitSavingsCardContribution).not.toHaveBeenCalled();
  expect(readStatus).not.toHaveBeenCalled();
});

it('ignores snapshots for a different goal', async () => {
  const { args } = setup({ goalId: 'goal-2' });

  await sendSavingsCardContributionSnapshot(args);

  expect(submitSavingsCardContribution).not.toHaveBeenCalled();
});

it('keeps the request retryable when submission fails', async () => {
  jest
    .mocked(submitSavingsCardContribution)
    .mockRejectedValueOnce(new Error('offline'));
  const { args, readStatus, setters } = setup();

  await sendSavingsCardContributionSnapshot(args);

  expect(readStatus).not.toHaveBeenCalled();
  expect(setters.setMessage).toHaveBeenCalledWith(
    'We could not confirm the request. Your saved request is unchanged; retry uses the same key.'
  );
  expect(setters.setAllowRetry).toHaveBeenCalledWith(true);
});

it('stays silent when aborted mid-flight', async () => {
  jest
    .mocked(submitSavingsCardContribution)
    .mockImplementationOnce(async () => {
      args.controllers.forEach((controller) => {
        controller.abort();
      });
      return {
        operationId: 'operation-1',
        goalId: snapshot.goalId,
        amountKobo: snapshot.amountKobo,
        currency: 'NGN' as const,
        status: 'pending' as const,
      };
    });
  const { args, readStatus, setters } = setup();

  await sendSavingsCardContributionSnapshot(args);

  expect(readStatus).not.toHaveBeenCalled();
  expect(setters.setMessage).toHaveBeenCalledWith('');
  expect(setters.setAllowRetry).not.toHaveBeenCalledWith(true);
});

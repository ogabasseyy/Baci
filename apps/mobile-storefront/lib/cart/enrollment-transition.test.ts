import {
  createEnrollmentTransition,
  markEnrollmentEnabled,
  retireEnrollmentSession,
} from './enrollment-transition';

it('does not retire before any committed enabled period', async () => {
  const state = createEnrollmentTransition();
  const remove = jest.fn().mockResolvedValue(undefined);
  await retireEnrollmentSession(state, 'merchant-a', remove);
  expect(remove).not.toHaveBeenCalled();
});

it('retires once after an enabled period', async () => {
  const state = createEnrollmentTransition();
  const remove = jest.fn().mockResolvedValue(undefined);
  markEnrollmentEnabled(state);
  await retireEnrollmentSession(state, 'merchant-a', remove);
  await retireEnrollmentSession(state, 'merchant-a', remove);
  expect(remove).toHaveBeenCalledTimes(1);
});

it('retries retirement after a transient storage failure', async () => {
  const state = createEnrollmentTransition();
  const remove = jest
    .fn()
    .mockRejectedValueOnce(new Error('secure store busy'))
    .mockResolvedValue(undefined);
  markEnrollmentEnabled(state);
  await retireEnrollmentSession(state, 'merchant-a', remove);
  await retireEnrollmentSession(state, 'merchant-a', remove);
  expect(remove).toHaveBeenCalledTimes(2);
});

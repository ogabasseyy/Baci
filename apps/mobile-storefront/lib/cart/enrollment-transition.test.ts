import {
  createEnrollmentTransition,
  markEnrollmentEnabled,
  retireEnrollmentSession,
  retireLegacySharedCart,
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

it('rotates and releases the checkout generation when retiring the shared reference', () => {
  const clearLegacy = jest.fn();
  const persistGeneration = jest.fn();
  const releaseGeneration = jest.fn();
  retireLegacySharedCart({
    getLegacy: () => ({
      sharedCartRef: { cartId: 'cart-1' },
      checkoutGeneration: 'generation-old',
    }),
    clearLegacy,
    mintGeneration: () => 'generation-new',
    persistGeneration,
    releaseGeneration,
  });
  expect(clearLegacy).toHaveBeenCalledWith('generation-new');
  expect(persistGeneration).toHaveBeenCalledWith('generation-new');
  expect(releaseGeneration).toHaveBeenCalledWith('generation-old');
});

it('rotates even when the shared reference was already published away', () => {
  const clearLegacy = jest.fn();
  const releaseGeneration = jest.fn();
  retireLegacySharedCart({
    getLegacy: () => ({ checkoutGeneration: 'generation-old' }),
    clearLegacy,
    mintGeneration: () => 'generation-new',
    persistGeneration: jest.fn(),
    releaseGeneration,
  });
  expect(clearLegacy).toHaveBeenCalledWith('generation-new');
  expect(releaseGeneration).toHaveBeenCalledWith('generation-old');
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

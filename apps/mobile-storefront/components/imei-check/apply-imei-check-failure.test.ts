import { applyImeiCheckFailure } from './apply-imei-check-failure';

const actions = () => ({
  clearKey: jest.fn(),
  signIn: jest.fn(),
  topUp: jest.fn(),
  refetchWallet: jest.fn(async () => undefined),
  showError: jest.fn(),
});
const outcome = (overrides: Record<string, unknown> = {}) =>
  ({
    shouldClearIdempotencyKey: false,
    shouldRedirectToLogin: false,
    topUpAmount: null,
    shouldRefetchWallet: false,
    errorMessage: null,
    ...overrides,
  }) as never;

describe('applyImeiCheckFailure', () => {
  it('clears the key and sends the customer to sign in', async () => {
    const a = actions();
    await applyImeiCheckFailure(
      outcome({ shouldClearIdempotencyKey: true, shouldRedirectToLogin: true }),
      a
    );
    expect(a.clearKey).toHaveBeenCalled();
    expect(a.signIn).toHaveBeenCalled();
    expect(a.showError).not.toHaveBeenCalled();
  });

  it('asks for a top-up of the amount short', async () => {
    const a = actions();
    await applyImeiCheckFailure(outcome({ topUpAmount: 500 }), a);
    expect(a.topUp).toHaveBeenCalledWith(500);
  });

  it('refreshes the wallet, then shows the error', async () => {
    const a = actions();
    await applyImeiCheckFailure(
      outcome({ shouldRefetchWallet: true, errorMessage: 'Try again' }),
      a
    );
    expect(a.refetchWallet).toHaveBeenCalled();
    expect(a.showError).toHaveBeenCalledWith('Try again');
  });
});

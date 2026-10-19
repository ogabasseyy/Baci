import { jest } from '@jest/globals';

const { validateCheckoutUser } =
  require('./orders-user-validation') as typeof import('./orders-user-validation');
describe('validateCheckoutUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the authenticated user when validation succeeds', async () => {
    const auth = {
      getUser: jest.fn(async () => ({
        data: { user: { id: 'user-a' } },
        error: null,
      })),
    };

    await expect(validateCheckoutUser(auth as never, 'token')).resolves.toEqual(
      {
        data: { user: { id: 'user-a' } },
        error: null,
      }
    );
    expect(auth.getUser).toHaveBeenCalledWith('token');
  });

  it('fails closed when user validation never settles', async () => {
    jest.useFakeTimers();
    const auth = {
      getUser: jest.fn(() => new Promise<never>(() => undefined)),
    };
    const pending = validateCheckoutUser(auth as never, 'token');
    const assertion = expect(pending).resolves.toMatchObject({
      data: { user: null },
      error: expect.any(Error),
    });
    await jest.advanceTimersByTimeAsync(4_000);
    await assertion;
  });
});

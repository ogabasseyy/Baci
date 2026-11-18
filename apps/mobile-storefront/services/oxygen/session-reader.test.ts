import { createOxygenSessionReader } from './session-reader';

const session = {
  access_token: 'expired',
  user: { id: 'owner' },
  expires_at: 1,
};
it('renews an expired session once for concurrent Oxygen reads', async () => {
  let done: (result: {
    data: { session: typeof session };
    error: null;
  }) => void = () => {};
  const auth = {
    getSession: jest.fn().mockResolvedValue({ data: { session }, error: null }),
    refreshSession: jest.fn(
      () =>
        new Promise<{ data: { session: typeof session }; error: null }>(
          (resolve) => {
            done = resolve;
          }
        )
    ),
  };
  const read = createOxygenSessionReader(
    auth,
    'owner',
    () => true,
    () => 2000
  );
  const a = read();
  const b = read();
  await Promise.resolve();
  done({
    data: { session: { ...session, access_token: 'renewed', expires_at: 100 } },
    error: null,
  });
  expect((await a)?.access_token).toBe('renewed');
  expect((await b)?.access_token).toBe('renewed');
  expect(auth.refreshSession).toHaveBeenCalledTimes(1);
});
it('rejects a renewed session after the owner changes', async () => {
  let current = true;
  const auth = {
    getSession: jest.fn().mockResolvedValue({ data: { session }, error: null }),
    refreshSession: jest.fn(async () => {
      current = false;
      return {
        data: { session: { ...session, expires_at: 100 } },
        error: null,
      };
    }),
  };
  expect(
    await createOxygenSessionReader(
      auth,
      'owner',
      () => current,
      () => 2000
    )()
  ).toBeNull();
});
it('keeps a valid session and never renews another user session', async () => {
  const auth = {
    getSession: jest.fn().mockResolvedValue({
      data: { session: { ...session, expires_at: 100 } },
      error: null,
    }),
    refreshSession: jest.fn(),
  };
  expect(
    await createOxygenSessionReader(
      auth,
      'owner',
      () => true,
      () => 2000
    )()
  ).not.toBeNull();
  expect(
    await createOxygenSessionReader(
      auth,
      'other',
      () => true,
      () => 2000
    )()
  ).toBeNull();
  expect(auth.refreshSession).not.toHaveBeenCalled();
});

it('reports a disconnected auth transport without misclassifying it as sign-in expiry', async () => {
  const auth = {
    getSession: jest.fn().mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthRetryableFetchError' },
    }),
    refreshSession: jest.fn(),
  };
  await expect(
    createOxygenSessionReader(auth, 'owner', () => true)()
  ).rejects.toMatchObject({
    code: 'transport',
    dispatchState: 'not_dispatched',
  });
  expect(auth.refreshSession).not.toHaveBeenCalled();
});

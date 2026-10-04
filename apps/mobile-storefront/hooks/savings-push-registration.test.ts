import { describe, expect, it, jest } from '@jest/globals';
import {
  retrySavingsPushRegistration,
  type SavingsPushRegistrationIdentity,
} from './savings-push-registration';

type TestState = {
  userId: string | null;
  merchantId: string | null;
  token: string | null;
  registeredKey: string | null;
  isMounted: boolean;
};
type RegistrationOptions = Parameters<typeof retrySavingsPushRegistration>[0];

function createOptions(
  overrides: Partial<Parameters<typeof retrySavingsPushRegistration>[0]> = {}
) {
  const state: TestState = {
    userId: 'user-1',
    merchantId: 'merchant-1',
    token: 'ExponentPushToken[stored]',
    registeredKey: null as string | null,
    isMounted: true,
  };
  return {
    state,
    getState: () => state,
    inFlight: { current: false },
    pending: { current: false },
    isEnabled: jest.fn(async () => true),
    prepare: jest.fn(async () => {}),
    hasPermission: jest.fn(async () => true),
    isOptedOut: jest.fn(async () => false),
    save: jest.fn(async () => true),
    setIdentity: jest.fn((identity: SavingsPushRegistrationIdentity | null) => {
      state.registeredKey = identity?.key ?? null;
    }),
    setError: jest.fn(),
    ...overrides,
  };
}

describe('retrySavingsPushRegistration', () => {
  it('registers a replacement cached token for the same user and merchant', async () => {
    const options = createOptions();
    options.state.registeredKey = JSON.stringify([
      'user-1',
      'merchant-1',
      'ExponentPushToken[previous]',
    ]);

    await retrySavingsPushRegistration(options);

    expect(options.save).toHaveBeenCalledWith(
      'ExponentPushToken[stored]',
      'user-1',
      'merchant-1'
    );
    expect(options.setIdentity).toHaveBeenCalledTimes(1);
  });
  it('does not enter native registration when storefront isolation excludes push', async () => {
    const options = createOptions({ isEnabled: async () => false });

    await retrySavingsPushRegistration(options);

    expect(options.prepare).not.toHaveBeenCalled();
    expect(options.hasPermission).not.toHaveBeenCalled();
    expect(options.save).not.toHaveBeenCalled();
  });

  it('does not save when notification permission is no longer granted', async () => {
    const options = createOptions({ hasPermission: async () => false });

    await retrySavingsPushRegistration(options);

    expect(options.isOptedOut).not.toHaveBeenCalled();
    expect(options.save).not.toHaveBeenCalled();
    expect(options.setIdentity).not.toHaveBeenCalled();
  });

  it('does not save when the user opted out', async () => {
    const options = createOptions({ isOptedOut: async () => true });

    await retrySavingsPushRegistration(options);

    expect(options.save).not.toHaveBeenCalled();
    expect(options.setIdentity).not.toHaveBeenCalled();
  });

  it.each([
    ['logout', { userId: null, isMounted: true }],
    ['account switch', { userId: 'user-2', isMounted: true }],
    ['unmount', { userId: 'user-1', isMounted: false }],
  ])('ignores a deferred save result after %s', async (_transition, change) => {
    let resolveSave!: (saved: boolean) => void;
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const save = jest.fn<RegistrationOptions['save']>().mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve;
          notifyStarted();
        })
    );
    const options = createOptions({ save });

    const pendingSave = retrySavingsPushRegistration(options);
    await started;
    Object.assign(options.state, change);
    resolveSave(true);
    await pendingSave;

    expect(options.setIdentity).not.toHaveBeenCalled();
    expect(options.setError).not.toHaveBeenCalled();
  });

  it('deduplicates overlapping attempts and drains the latest state once', async () => {
    let resolveSave!: (saved: boolean) => void;
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const save = jest.fn<RegistrationOptions['save']>().mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve;
          notifyStarted();
        })
    );
    const options = createOptions({ save });

    const first = retrySavingsPushRegistration(options);
    const overlapping = retrySavingsPushRegistration(options);
    await started;
    expect(save).toHaveBeenCalledTimes(1);

    resolveSave(true);
    await Promise.all([first, overlapping]);
    expect(save).toHaveBeenCalledTimes(1);
    expect(options.setIdentity).toHaveBeenCalledTimes(1);
  });

  it('catches opt-out lookup failures without saving or rejecting', async () => {
    const options = createOptions({
      isOptedOut: async () => {
        throw new Error('storage unavailable');
      },
    });

    await expect(
      retrySavingsPushRegistration(options)
    ).resolves.toBeUndefined();
    expect(options.save).not.toHaveBeenCalled();
    expect(options.setError).toHaveBeenCalledWith(
      'Failed to register token with server'
    );
  });
});

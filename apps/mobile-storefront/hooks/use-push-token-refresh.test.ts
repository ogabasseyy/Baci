import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { getNativePushRegistration } from '@/lib/hosted-staging-push-capability';
import { isPushOptedOut } from '@/lib/push-token-storage';
import { registerForPushNotifications } from '@/services/push-notifications';
import { usePushTokenRefresh } from './use-push-token-refresh';

jest.mock('@/lib/hosted-staging-push-capability', () => ({
  getNativePushRegistration: jest.fn(),
}));
jest.mock('@/lib/push-token-storage', () => ({
  isPushOptedOut: jest.fn(),
}));
jest.mock('@/services/push-notifications', () => ({
  registerForPushNotifications: jest.fn(),
}));

const mockAddPushTokenListener = jest.fn();
jest.mock('expo-notifications', () => ({
  addPushTokenListener: (...args: unknown[]) =>
    mockAddPushTokenListener(...args),
}));

const capability = { projectId: 'project-1' };

function setup(
  state = {
    userId: 'user-1',
    merchantId: 'merchant-1',
    token: null as string | null,
  }
) {
  const current = { ...state };
  const onToken = jest.fn().mockResolvedValue(undefined);
  const retry = jest.fn().mockResolvedValue(undefined);
  return {
    current,
    onToken,
    retry,
    render: () =>
      renderHook(() =>
        usePushTokenRefresh({
          getState: () => ({ ...current }),
          onToken,
          retry,
        })
      ),
  };
}

function appStateListener() {
  return jest.mocked(AppState.addEventListener).mock.calls.at(-1)?.[1] as (
    state: string
  ) => void;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getNativePushRegistration).mockReturnValue(capability as never);
  jest.mocked(isPushOptedOut).mockResolvedValue(false);
  jest.mocked(registerForPushNotifications).mockResolvedValue('token-1');
  mockAddPushTokenListener.mockImplementation(() => ({ remove: jest.fn() }));
});

it('refreshes on foreground and retries afterwards', async () => {
  const { onToken, retry, render } = setup();
  render();

  await act(async () => {
    appStateListener()('active');
  });

  await waitFor(() => expect(onToken).toHaveBeenCalledWith('token-1'));
  expect(registerForPushNotifications).toHaveBeenCalledWith({
    requestPermission: false,
  });
  expect(retry).toHaveBeenCalledTimes(1);
});

it('passes rotated listener tokens through to registration', async () => {
  const { onToken, render } = setup();
  render();
  await act(async () => {});

  const listener = mockAddPushTokenListener.mock.calls[0][0];
  const rotated = { data: 'rotated', type: 'ios' };
  await act(async () => {
    listener(rotated);
  });

  await waitFor(() => expect(onToken).toHaveBeenCalledWith('token-1'));
  expect(registerForPushNotifications).toHaveBeenCalledWith({
    requestPermission: false,
    devicePushToken: rotated,
  });
});

it('drops results when the account changes mid-refresh', async () => {
  const { current, onToken, render } = setup();
  let release!: (token: string | null) => void;
  jest.mocked(registerForPushNotifications).mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  render();

  let pending!: Promise<void>;
  await act(async () => {
    pending = (async () => {
      appStateListener()('active');
    })();
  });
  current.userId = 'user-2';
  await act(async () => {
    release('token-1');
    await pending;
  });

  expect(onToken).not.toHaveBeenCalled();
});

it('skips registration while opted out', async () => {
  jest.mocked(isPushOptedOut).mockResolvedValue(true);
  const { onToken, retry, render } = setup();
  render();

  await act(async () => {
    appStateListener()('active');
  });
  await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));

  expect(registerForPushNotifications).not.toHaveBeenCalled();
  expect(onToken).not.toHaveBeenCalled();
});

it('stays silent without native capability or token module', async () => {
  jest.mocked(getNativePushRegistration).mockReturnValue(null);
  const { onToken, retry, render } = setup();
  const { unmount } = render();

  await act(async () => {
    appStateListener()('active');
  });

  expect(registerForPushNotifications).not.toHaveBeenCalled();
  expect(onToken).not.toHaveBeenCalled();
  expect(mockAddPushTokenListener).not.toHaveBeenCalled();
  await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  unmount();
});

it('removes subscriptions and ignores late events after unmount', async () => {
  const removeAppState = jest.fn();
  const removeToken = jest.fn();
  jest
    .mocked(AppState.addEventListener)
    .mockReturnValueOnce({ remove: removeAppState } as never);
  mockAddPushTokenListener.mockReturnValueOnce({ remove: removeToken });
  const { onToken, render } = setup();
  const { unmount } = render();
  await act(async () => {});
  const listener = appStateListener();

  unmount();
  expect(removeAppState).toHaveBeenCalledTimes(1);
  expect(removeToken).toHaveBeenCalledTimes(1);

  await act(async () => {
    listener('active');
  });
  expect(onToken).not.toHaveBeenCalled();
});

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { AppState } from 'react-native';
import {
  OxygenHostedSurface,
  type OxygenHostedSurfaceProps,
} from './OxygenHostedSurface';
import { recordOxygenSelfieDiagnostic } from './oxygen-selfie-diagnostics';

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(),
  WebBrowserResultType: {
    CANCEL: 'cancel',
    DISMISS: 'dismiss',
    OPENED: 'opened',
  },
}));
jest.mock('./oxygen-selfie-diagnostics', () => ({
  recordOxygenSelfieDiagnostic: jest.fn(),
}));

const openBrowser = jest.mocked(WebBrowser.openBrowserAsync);
const url = 'https://pay.example/checkout';

function defaults(): OxygenHostedSurfaceProps {
  return {
    url,
    kind: 'payment',
    capabilities: {
      hostedOrigins: ['https://pay.example'],
      selfieOrigins: ['https://selfie.example'],
    },
    active: true,
    onRefresh: jest.fn(async () => undefined),
    onExit: jest.fn(),
  };
}

function continueToOxygen() {
  fireEvent.press(screen.getByRole('button', { name: 'Continue to Oxygen' }));
}

beforeEach(() => {
  jest.clearAllMocks();
  AppState.currentState = 'active';
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(() => ({ remove: jest.fn() }));
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('opens only on a shopper action and checks server status after iOS Safari closes', async () => {
  const props = defaults();
  let dismiss!: (result: WebBrowser.WebBrowserResult) => void;
  openBrowser.mockReturnValueOnce(
    new Promise((resolve) => {
      dismiss = resolve;
    })
  );
  render(<OxygenHostedSurface {...props} />);

  expect(openBrowser).not.toHaveBeenCalled();
  act(continueToOxygen);
  expect(openBrowser).toHaveBeenCalledWith(url);
  expect(
    screen.getByRole('button', { name: 'Opening Oxygen…' })
  ).toBeDisabled();
  expect(props.onRefresh).not.toHaveBeenCalled();

  await act(async () =>
    dismiss({ type: WebBrowser.WebBrowserResultType.CANCEL })
  );
  expect(props.onRefresh).toHaveBeenCalledTimes(1);
  expect(props.onExit).not.toHaveBeenCalled();
});

it('checks server status when Android returns from a Custom Tab', async () => {
  const props = defaults();
  openBrowser.mockResolvedValueOnce({
    type: WebBrowser.WebBrowserResultType.OPENED,
  });
  render(<OxygenHostedSurface {...props} />);
  await act(async () => continueToOxygen());
  expect(openBrowser).toHaveBeenCalledWith(url);
  expect(props.onRefresh).not.toHaveBeenCalled();

  const onState = jest.mocked(AppState.addEventListener).mock.lastCall?.[1];
  expect(onState).toBeDefined();
  await act(async () => {
    onState?.('background');
    onState?.('active');
  });
  expect(props.onRefresh).toHaveBeenCalledTimes(1);
});

it('checks server status after returning even if automatic reads were exhausted', async () => {
  jest.useFakeTimers();
  try {
    const props = defaults();
    render(<OxygenHostedSurface {...props} />);
    for (let index = 0; index < 9; index++) {
      await act(async () => jest.advanceTimersByTime(5000));
    }
    expect(props.onRefresh).toHaveBeenCalledTimes(8);
    expect(screen.getByRole('button', { name: 'Check status' })).toBeEnabled();
    const onState = jest.mocked(AppState.addEventListener).mock.lastCall?.[1];
    expect(onState).toBeDefined();
    await act(async () => {
      onState?.('background');
      onState?.('active');
    });
    expect(props.onRefresh).toHaveBeenCalledTimes(8);

    openBrowser.mockResolvedValueOnce({
      type: WebBrowser.WebBrowserResultType.DISMISS,
    });
    await act(async () => continueToOxygen());
    expect(props.onRefresh).toHaveBeenCalledTimes(9);
    expect(screen.queryByRole('button', { name: 'Check status' })).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

it.each([
  'http://pay.example/checkout',
  'https://pay.example.invalid/checkout',
  'javascript:alert(1)',
])('does not open a link outside the pinned Oxygen origin %s', (untrusted) => {
  render(<OxygenHostedSurface {...defaults()} url={untrusted} />);
  expect(screen.getByRole('alert')).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Continue to Oxygen' })
  ).toBeNull();
  expect(openBrowser).not.toHaveBeenCalled();
});

it('offers selfie recovery when a link expires and launches only the replacement URL', async () => {
  const props = { ...defaults(), kind: 'selfie' as const };
  const onRenew = jest.fn();
  const view = render(
    <OxygenHostedSurface
      {...props}
      url="https://selfie.example/old"
      sessionExpired
      onRenew={onRenew}
    />
  );
  expect(
    screen.queryByRole('button', { name: 'Continue to Oxygen' })
  ).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(onRenew).toHaveBeenCalledTimes(1);
  expect(openBrowser).not.toHaveBeenCalled();

  openBrowser.mockResolvedValueOnce({
    type: WebBrowser.WebBrowserResultType.DISMISS,
  });
  view.rerender(
    <OxygenHostedSurface {...props} url="https://selfie.example/fresh" />
  );
  await act(async () => continueToOxygen());
  expect(openBrowser).toHaveBeenCalledWith('https://selfie.example/fresh');
  expect(recordOxygenSelfieDiagnostic).toHaveBeenCalledWith('browser_returned');
  expect(props.onRefresh).toHaveBeenCalledTimes(1);
});

it('shows a browser launch error and leaves the order resumable', async () => {
  const props = defaults();
  openBrowser.mockRejectedValueOnce(new Error('Browser unavailable'));
  render(<OxygenHostedSurface {...props} />);
  await act(async () => continueToOxygen());

  expect(screen.getByRole('alert')).toHaveTextContent(
    /Your progress is saved./
  );
  expect(
    screen.getByRole('button', { name: 'Continue to Oxygen' })
  ).toBeEnabled();
  expect(props.onRefresh).not.toHaveBeenCalled();
  fireEvent.press(
    screen.getByRole('button', { name: 'Return to saved progress' })
  );
  expect(props.onExit).toHaveBeenCalledTimes(1);
});

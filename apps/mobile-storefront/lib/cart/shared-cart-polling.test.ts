import { AppState } from 'react-native';
import { startSharedCartPolling } from './shared-cart-polling';

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(),
  },
}));

const addEventListener = AppState.addEventListener as jest.Mock;

function setup(state: string) {
  (AppState as { currentState: string }).currentState = state;
  const remove = jest.fn();
  let listener: ((next: string) => void) | undefined;
  addEventListener.mockImplementation(
    (_event: string, cb: (next: string) => void) => {
      listener = cb;
      return { remove };
    }
  );
  const refresh = jest.fn().mockResolvedValue(undefined);
  const stop = startSharedCartPolling({
    getController: () => ({ refresh }),
    hasSnapshot: () => true,
  });
  return { refresh, remove, stop, emit: (next: string) => listener?.(next) };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

it('polls only while foregrounded with a snapshot', () => {
  const { refresh, stop } = setup('active');
  jest.advanceTimersByTime(30000);
  expect(refresh).toHaveBeenCalledTimes(1);
  (AppState as { currentState: string }).currentState = 'background';
  jest.advanceTimersByTime(60000);
  expect(refresh).toHaveBeenCalledTimes(1);
  stop();
});

it('refreshes on a foreground transition', () => {
  const { refresh, emit, stop } = setup('background');
  emit('background');
  expect(refresh).not.toHaveBeenCalled();
  emit('active');
  expect(refresh).toHaveBeenCalledTimes(1);
  stop();
});

it('removes the listener and interval on teardown', () => {
  const { refresh, remove, stop } = setup('active');
  stop();
  jest.advanceTimersByTime(90000);
  expect(refresh).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledTimes(1);
});

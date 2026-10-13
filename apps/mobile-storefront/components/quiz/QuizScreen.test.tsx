import { jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QuizScreen } from '@/components/quiz/QuizScreen';
import type { QuizAttempt, QuizEvent, QuizResult } from '@/services/quiz';
import {
  fetchQuizEvents,
  startQuizAttempt,
  submitQuizAnswer,
} from '@/services/quiz';
import { useQuizStore } from '@/stores/quiz-store';

jest.mock('@/components/quiz/QuizMusicPlayer', () => ({
  QuizMusicPlayer: () => null,
}));
jest.mock('@/components/quiz/QuizGameplayAdFooter', () => ({
  QuizGameplayAdFooter: () => null,
}));

// The username gate pulls in additional modules (UsernamePrompt, the zod
// username schema, the gate modal) that add one-time mount cost to whichever
// test in this file runs first — that can push it past Jest's 5000ms default
// under load. Widen this file's timeout rather than the shared jest config.
jest.setTimeout(15000);

// Defaults to a customer that already has a username so the pre-existing
// start-flow tests below are unaffected by the username gate. The gate
// itself is covered by the dedicated test further down.
let mockUsername: string | null = 'ogafan';
let mockAuthUserId: string | null = 'quiz-shopper';
// Start-flow tests default to an adult DOB so the 18+ gate passes; the
// dedicated date-of-birth gate tests below set it to null.
let mockDateOfBirth: string | null = '1990-06-15';
const mockSetUsername =
  jest.fn<
    (
      username: string
    ) => Promise<{ success: boolean; error?: string; username?: string }>
  >();
const mockSetDateOfBirth =
  jest.fn<
    (
      dateOfBirth: string
    ) => Promise<{ success: boolean; error?: string; dateOfBirth?: string }>
  >();

jest.mock('@/stores/auth-store', () => {
  const getState = () => ({
    customer: {
      id: 'customer-1',
      username: mockUsername,
      date_of_birth: mockDateOfBirth,
    },
    setUsername: mockSetUsername,
    setDateOfBirth: mockSetDateOfBirth,
    // useQuizStartFlow reads getState().user?.id to guard against account
    // switches, so the mock must expose the static getState method too.
    user: mockAuthUserId ? { id: mockAuthUserId } : null,
  });
  const useAuthStore = (
    selector: (state: ReturnType<typeof getState>) => unknown
  ) => selector(getState());
  useAuthStore.getState = getState;
  return { useAuthStore };
});

// The date-of-birth gate transitively renders DateTimePickerField, which
// imports the native picker. Mock it so the module resolves and a tapped field
// yields a fixed, valid past date (1990-05-23).
type MockDateTimePickerProps = {
  onChange: (event: { type: 'set' }, date: Date) => void;
};
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: ({ onChange }: MockDateTimePickerProps) => {
    const { Pressable, Text } =
      jest.requireActual<typeof import('react-native')>('react-native');
    return (
      <Pressable
        accessibilityLabel="mock-date-picker"
        accessibilityRole="button"
        onPress={() => onChange({ type: 'set' }, new Date(1990, 4, 23))}
      >
        <Text>mock picker</Text>
      </Pressable>
    );
  },
}));

const quizEventNow = Date.now();
const quizEvent: QuizEvent = {
  endsAt: new Date(quizEventNow + 10 * 60 * 1000).toISOString(),
  id: 'event-1',
  prizeName: 'N50,000 store credit',
  questionCount: 3,
  startsAt: new Date(quizEventNow - 60 * 1000).toISOString(),
  status: 'open',
  title: 'Daily Prize Quiz',
};

const createFutureDeadline = (secondsFromNow: number) =>
  new Date(Date.now() + secondsFromNow * 1000).toISOString();

// Entry is free, so a fresh attempt spends nothing. Overridable so the
// deploy-window case (a stale database that still charged) can be exercised.
const createQuizAttempt = (
  overrides: Partial<QuizAttempt> = {}
): QuizAttempt => ({
  attemptId: 'attempt-1',
  eventId: 'event-1',
  examPassPointsSpent: 0,
  remainingLoyaltyPoints: 5,
  question: {
    deadlineAt: createFutureDeadline(30),
    id: 'question-1',
    index: 1,
    options: [
      { id: 'a', label: '3' },
      { id: 'b', label: '4' },
    ],
    prompt: 'What is 2 + 2?',
    timeLimitSeconds: 30,
    total: 3,
  },
  ...overrides,
});

const quizResult: QuizResult = {
  attemptId: 'attempt-1',
  correctAnswers: 1,
  prizeEligible: true,
  status: 'completed',
  totalQuestions: 3,
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function acceptRulesAndStart() {
  fireEvent.press(
    await screen.findByRole('button', {
      name: 'Play for free Daily Prize Quiz',
    })
  );
  fireEvent.press(
    screen.getByRole('checkbox', { name: 'Accept quiz rules and terms' })
  );
  fireEvent.press(screen.getByRole('button', { name: 'Accept and play quiz' }));
}

// Anti multi-accounting: QuizScreen sends a device fingerprint so the server can
// share one attempt budget across every account started from this device.
jest.mock('@/lib/get-quiz-device-fingerprint', () => ({
  getQuizDeviceFingerprint: jest.fn(async () => 'a'.repeat(64)),
}));

jest.mock('@/services/quiz', () => ({
  fetchQuizEvents: jest.fn(),
  startQuizAttempt: jest.fn(),
  submitQuizAnswer: jest.fn(),
}));
jest.mock('@/services/quiz-attempts', () => ({
  createQuizStartRequestId: () => 'start-request-1',
  startQuizAttemptV2: jest.fn(),
  submitQuizAnswerV2: jest.fn(),
}));
describe('QuizScreen', () => {
  beforeEach(() => {
    useQuizStore.getState().reset();
    mockUsername = 'ogafan';
    mockAuthUserId = 'quiz-shopper';
    mockDateOfBirth = '1990-06-15';
    mockSetUsername.mockReset();
    mockSetDateOfBirth.mockReset();
    jest.mocked(fetchQuizEvents).mockResolvedValue([quizEvent]);
    jest
      .mocked(startQuizAttempt)
      .mockImplementation(async () => createQuizAttempt());
    jest.mocked(submitQuizAnswer).mockResolvedValue(quizResult);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // This is the first render in the file, so it absorbs React Native's one-time
  // cold-start cost. Under `jest --runInBand` memory pressure (560+ suites) that
  // can exceed the default 5s per-test timeout even though the flow itself is
  // instant, so the first test gets extra headroom (see jest.setup.ts note on
  // the same accumulated-pressure effect widening asyncUtilTimeout).
  it('renders a load error as an accessible alert', async () => {
    jest
      .mocked(fetchQuizEvents)
      .mockRejectedValueOnce(new Error('Events offline'));

    render(<QuizScreen integrityTier="device" locale="en-US" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Events offline'
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Retry loading quiz events' })
    );

    expect(await screen.findByText('Daily Prize Quiz')).toBeTruthy();
  }, 15_000);

  it('renders fetched quiz events', async () => {
    render(<QuizScreen integrityTier="device" locale="en-US" />);

    expect(await screen.findByText('Daily Prize Quiz')).toBeTruthy();
    expect(screen.getByText('Win N50,000 store credit')).toBeTruthy();
    expect(screen.getByText('Every second counts.')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Play for free Daily Prize Quiz',
      })
    ).toBeTruthy();
  });

  it('shows a pending start state and renders the first question after start', async () => {
    const startDeferred = createDeferred<QuizAttempt>();
    jest.mocked(startQuizAttempt).mockReturnValueOnce(startDeferred.promise);
    render(<QuizScreen integrityTier="device" locale="en-US" />);

    await acceptRulesAndStart();

    expect(await screen.findByText('Starting...')).toBeTruthy();
    expect(startQuizAttempt).toHaveBeenCalledWith({
      deviceFingerprint: 'a'.repeat(64),
      eventId: 'event-1',
      expectedUserId: 'quiz-shopper',
      integrityTier: 'device',
    });

    await act(async () => {
      startDeferred.resolve(createQuizAttempt());
      await startDeferred.promise;
    });

    expect(await screen.findByText('What is 2 + 2?')).toBeTruthy();
    expect(screen.getByText('Time left: 30s')).toBeTruthy();
    expect(
      screen.getByText('Free entry — no loyalty points used.')
    ).toBeTruthy();
  });

  it('resets quiz state when the authenticated user changes while mounted', async () => {
    useQuizStore.setState({
      attempt: createQuizAttempt(),
      status: 'question',
    });
    const { rerender } = render(
      <QuizScreen integrityTier="device" locale="en-US" />
    );
    expect(await screen.findByText('What is 2 + 2?')).toBeTruthy();

    act(() => {
      mockAuthUserId = 'another-shopper';
      rerender(<QuizScreen integrityTier="device" locale="en-US" />);
    });

    await waitFor(() => expect(useQuizStore.getState().attempt).toBeNull());
    expect(useQuizStore.getState().v2Attempt).toBeNull();
  });
});

import { jest } from '@jest/globals';
import {
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
import { QuizServiceError } from '@/services/quiz-types';
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
    user: { id: 'quiz-shopper' },
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

function _createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
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

describe('QuizScreen date-of-birth gate', () => {
  beforeEach(() => {
    useQuizStore.getState().reset();
    mockUsername = 'ogafan';
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

  async function acceptRulesAndPlay() {
    fireEvent.press(
      await screen.findByRole('button', {
        name: 'Play for free Daily Prize Quiz',
      })
    );
    fireEvent.press(
      await screen.findByRole('checkbox', {
        name: 'Accept quiz rules and terms',
      })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Accept and play quiz' })
    );
  }

  // This is the first render in the file, so it absorbs React Native's one-time
  // cold-start cost. Under `jest --runInBand` memory pressure (560+ suites) that
  // can exceed the default 5s per-test timeout even though the flow itself is
  // instant, so the first test gets extra headroom (see jest.setup.ts note on
  // the same accumulated-pressure effect widening asyncUtilTimeout).

  it('gates the quiz start behind a date of birth, then starts once one is set', async () => {
    mockDateOfBirth = null;
    mockSetDateOfBirth.mockResolvedValue({
      success: true,
      dateOfBirth: '1990-05-23',
    });
    render(<QuizScreen integrityTier="device" locale="en-US" />);

    await acceptRulesAndPlay();

    // Username is already set, so the 18+ gate is what blocks the start.
    expect(
      await screen.findByRole('header', { name: 'Confirm your date of birth' })
    ).toBeTruthy();
    expect(startQuizAttempt).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: 'Date of birth' }));
    fireEvent.press(screen.getByRole('button', { name: 'mock-date-picker' }));
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(mockSetDateOfBirth).toHaveBeenCalledWith('1990-05-23');
    });
    await waitFor(() => {
      expect(startQuizAttempt).toHaveBeenCalledWith({
        deviceFingerprint: 'a'.repeat(64),
        eventId: 'event-1',
        expectedUserId: 'quiz-shopper',
        integrityTier: 'device',
      });
    });
    expect(await screen.findByText('What is 2 + 2?')).toBeTruthy();
  });

  it('closes the date of birth gate without starting when cancelled', async () => {
    mockDateOfBirth = null;
    render(<QuizScreen integrityTier="device" locale="en-US" />);

    await acceptRulesAndPlay();
    fireEvent.press(
      await screen.findByRole('button', {
        name: 'Cancel date of birth setup',
      })
    );

    expect(
      screen.queryByRole('header', { name: 'Confirm your date of birth' })
    ).toBeNull();
    expect(startQuizAttempt).not.toHaveBeenCalled();
  });

  it('reopens the date of birth gate when the server rejects a stored DOB as under-18', async () => {
    // A DOB is already on file (an adult mistyped it), so the start goes
    // straight to the server, which rejects it. The correction gate must reopen
    // with the reason — it is the only DOB editor, and a rejected start creates
    // no attempt.
    mockDateOfBirth = '2015-01-01';
    jest
      .mocked(startQuizAttempt)
      .mockRejectedValueOnce(
        new QuizServiceError(
          'Quiz participation requires an adult profile (18+)',
          'quiz_age_restricted',
          403
        )
      );
    render(<QuizScreen integrityTier="device" locale="en-US" />);

    await acceptRulesAndPlay();

    expect(
      await screen.findByRole('header', { name: 'Confirm your date of birth' })
    ).toBeTruthy();
    expect(
      await screen.findByText(
        'Quiz participation requires an adult profile (18+)'
      )
    ).toBeTruthy();
    expect(startQuizAttempt).toHaveBeenCalledTimes(1);
  });
});

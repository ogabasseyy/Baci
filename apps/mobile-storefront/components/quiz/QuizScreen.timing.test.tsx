import { jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QuizScreen } from '@/components/quiz/QuizScreen';
import { getQuizDeviceFingerprint } from '@/lib/get-quiz-device-fingerprint';
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
jest.setTimeout(15000);
let mockUsername: string | null = 'ogafan';
let mockAuthUserId: string | null = 'quiz-shopper';
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
    user: mockAuthUserId ? { id: mockAuthUserId } : null,
  });
  const useAuthStore = (
    selector: (state: ReturnType<typeof getState>) => unknown
  ) => selector(getState());
  useAuthStore.getState = getState;
  return { useAuthStore };
});
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
  it('enters the pending state before device fingerprint lookup resolves', async () => {
    const fingerprintDeferred = createDeferred<string>();
    jest
      .mocked(getQuizDeviceFingerprint)
      .mockReturnValueOnce(fingerprintDeferred.promise);
    render(<QuizScreen integrityTier="device" locale="en-US" />);

    await acceptRulesAndStart();

    expect(await screen.findByText('Starting...')).toBeTruthy();
    expect(startQuizAttempt).not.toHaveBeenCalled();

    await act(async () => {
      fingerprintDeferred.resolve('c'.repeat(64));
      await fingerprintDeferred.promise;
    });

    await waitFor(() =>
      expect(startQuizAttempt).toHaveBeenCalledWith({
        deviceFingerprint: 'c'.repeat(64),
        eventId: 'event-1',
        expectedUserId: 'quiz-shopper',
        integrityTier: 'device',
      })
    );
  });

  // Deploy-window safety: an installed build can briefly talk to a database that
  // has not applied the free-entry migration and still charged a point. The
  // receipt must report what actually happened, not a hard-coded "free".
  it('reports a real charge when a stale database still spent a point', async () => {
    const startDeferred = createDeferred<QuizAttempt>();
    jest.mocked(startQuizAttempt).mockReturnValueOnce(startDeferred.promise);
    render(<QuizScreen integrityTier="device" locale="en-US" />);

    await acceptRulesAndStart();

    await act(async () => {
      startDeferred.resolve(
        createQuizAttempt({ examPassPointsSpent: 1, remainingLoyaltyPoints: 4 })
      );
      await startDeferred.promise;
    });

    expect(
      await screen.findByText('1 loyalty point used. 4 left.')
    ).toBeTruthy();
    expect(
      screen.queryByText('Free entry — no loyalty points used.')
    ).toBeNull();
  });

  it('shows a pending submit state and renders a successful result', async () => {
    const submitDeferred = createDeferred<QuizResult>();
    jest.mocked(submitQuizAnswer).mockReturnValueOnce(submitDeferred.promise);
    render(<QuizScreen integrityTier="strong" locale="en-US" />);

    await acceptRulesAndStart();
    fireEvent.press(await screen.findByRole('button', { name: 'Answer 4' }));

    const submitButton = screen.getByRole('button', { name: 'Submit answer' });
    fireEvent.press(submitButton);

    expect(
      screen.getByRole('button', { name: 'Submit answer' }).props
        .accessibilityState
    ).toMatchObject({ disabled: true });
    expect(
      screen.getByRole('button', { name: 'Answer 4' }).props.accessibilityState
    ).toMatchObject({ disabled: true, selected: true });
    expect(
      screen.getByRole('button', { name: 'Answer 3' }).props.accessibilityState
    ).toMatchObject({ disabled: true });
    expect(submitQuizAnswer).toHaveBeenCalledWith({
      answer: 'b',
      attemptId: 'attempt-1',
      clientAnsweredAt: expect.any(String),
      integrityTier: 'strong',
      questionId: 'question-1',
    });

    await act(async () => {
      submitDeferred.resolve(quizResult);
      await submitDeferred.promise;
    });

    expect(await screen.findByText('Result')).toBeTruthy();
    expect(screen.getByText('1 of 3 correct')).toBeTruthy();
  });
});

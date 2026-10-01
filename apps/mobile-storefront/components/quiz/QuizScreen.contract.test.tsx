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
import { submitQuizAnswerV2 } from '@/services/quiz-attempts';
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
function _createDeferred<T>() {
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
  it('closes the username gate without starting when cancelled', async () => {
    mockUsername = null;
    render(<QuizScreen integrityTier="device" locale="en-US" />);

    await acceptRulesAndStart();
    fireEvent.press(
      await screen.findByRole('button', { name: 'Cancel username setup' })
    );

    expect(
      screen.queryByRole('header', {
        name: 'Choose a username',
      })
    ).toBeNull();
    expect(startQuizAttempt).not.toHaveBeenCalled();
  });

  it('submits a contract-v2 answer immediately when tapped', async () => {
    const now = Date.now();
    jest.mocked(submitQuizAnswerV2).mockResolvedValue({
      attemptId: 'attempt-v2',
      eventEndsAt: new Date(now + 30_000).toISOString(),
      eventId: 'event-v2',
      resultsAvailableAt: new Date(now + 35_000).toISOString(),
      serverNow: new Date(now).toISOString(),
      status: 'submitted_pending_results',
    });
    useQuizStore.setState({
      lockedOptionId: null,
      status: 'question',
      v2Attempt: {
        attemptId: 'attempt-v2',
        eventEndsAt: new Date(now + 30_000).toISOString(),
        eventId: 'event-v2',
        question: {
          deadlineAt: new Date(now + 10_000).toISOString(),
          id: 'question-v2',
          index: 1,
          options: [{ id: 'answer-v2', label: 'Abuja' }],
          prompt: 'Capital of Nigeria?',
          timeLimitSeconds: 10,
          total: 20,
        },
        resultsAvailableAt: null,
        serverNow: new Date(now).toISOString(),
        status: 'in_progress',
      },
    });

    render(<QuizScreen integrityTier="device" />);
    fireEvent.press(screen.getByRole('button', { name: 'Answer Abuja' }));

    await waitFor(() =>
      expect(submitQuizAnswerV2).toHaveBeenCalledWith(
        expect.objectContaining({
          answer: 'answer-v2',
          attemptId: 'attempt-v2',
          expectedUserId: 'quiz-shopper',
          questionId: 'question-v2',
        })
      )
    );
    expect(await screen.findByText("You're all done!")).toBeTruthy();
  });

  it('shows a session error instead of silently dropping a v2 answer without a user', async () => {
    const now = Date.now();
    mockAuthUserId = null;
    useQuizStore.setState({
      lockedOptionId: null,
      status: 'question',
      v2Attempt: {
        attemptId: 'attempt-v2-no-user',
        eventEndsAt: new Date(now + 30_000).toISOString(),
        eventId: 'event-v2',
        question: {
          deadlineAt: new Date(now + 10_000).toISOString(),
          id: 'question-v2',
          index: 1,
          options: [{ id: 'answer-v2', label: 'Abuja' }],
          prompt: 'Capital of Nigeria?',
          timeLimitSeconds: 10,
          total: 20,
        },
        resultsAvailableAt: null,
        serverNow: new Date(now).toISOString(),
        status: 'in_progress',
      },
    });

    render(<QuizScreen integrityTier="device" />);
    fireEvent.press(screen.getByRole('button', { name: 'Answer Abuja' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your session changed. Please try again.'
    );
    expect(submitQuizAnswerV2).not.toHaveBeenCalled();
  });
});

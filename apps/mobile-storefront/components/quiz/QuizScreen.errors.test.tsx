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
  it('keeps a rejected retry load visible as an alert', async () => {
    useQuizStore.setState({ status: 'ready', error: 'Initial failure' });
    jest
      .mocked(fetchQuizEvents)
      .mockRejectedValueOnce(new Error('Reload failed'));
    render(<QuizScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reload failed');
  });
  it('does not request authenticated events when retrying signed out', async () => {
    mockAuthUserId = null;
    useQuizStore.setState({ status: 'ready', error: 'Initial failure' });
    render(<QuizScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(fetchQuizEvents).not.toHaveBeenCalled();
  });
  it('keeps the completed attempt result focused instead of reopening the event list', async () => {
    render(<QuizScreen integrityTier="strong" locale="en-US" />);

    await acceptRulesAndStart();
    fireEvent.press(await screen.findByRole('button', { name: 'Answer 4' }));
    fireEvent.press(screen.getByRole('button', { name: 'Submit answer' }));

    expect(await screen.findByText('Result')).toBeTruthy();
    expect(
      screen.queryByRole('button', {
        name: 'Play for free Daily Prize Quiz',
      })
    ).toBeNull();
  });

  it('renders a start error as an accessible alert', async () => {
    jest.mocked(startQuizAttempt).mockRejectedValue(new Error('Start failed'));
    render(<QuizScreen integrityTier="device" locale="en-US" />);

    await acceptRulesAndStart();

    expect(await screen.findByRole('alert')).toHaveTextContent('Start failed');
    expect(screen.queryByText('Daily Prize Quiz')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Retry loading quiz events' })
    ).toBeTruthy();
    expect(startQuizAttempt).toHaveBeenCalledWith({
      deviceFingerprint: 'a'.repeat(64),
      eventId: 'event-1',
      expectedUserId: 'quiz-shopper',
      integrityTier: 'device',
    });
  });

  it('renders a submit error as an accessible alert', async () => {
    jest.mocked(submitQuizAnswer).mockRejectedValue(new Error('Submit failed'));
    render(<QuizScreen integrityTier="strong" locale="en-US" />);

    await acceptRulesAndStart();
    fireEvent.press(await screen.findByRole('button', { name: 'Answer 4' }));
    fireEvent.press(screen.getByRole('button', { name: 'Submit answer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Submit failed');
    expect(screen.getByText('We couldn’t continue the quiz')).toBeTruthy();
    expect(screen.getByText('What is 2 + 2?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit answer' })).toBeTruthy();
    expect(submitQuizAnswer).toHaveBeenCalledWith({
      answer: 'b',
      attemptId: 'attempt-1',
      clientAnsweredAt: expect.any(String),
      integrityTier: 'strong',
      questionId: 'question-1',
    });
  });

  it('gates the quiz start behind setting a username, then starts once one is set', async () => {
    mockUsername = null;
    mockSetUsername.mockResolvedValue({ success: true, username: 'ogafan' });
    render(<QuizScreen integrityTier="device" locale="en-US" />);

    await acceptRulesAndStart();

    expect(
      await screen.findByRole('header', {
        name: 'Choose a username',
      })
    ).toBeTruthy();
    expect(startQuizAttempt).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByLabelText('Username'), 'ogafan');
    fireEvent.press(screen.getByRole('button', { name: 'Save & continue' }));

    await waitFor(() => {
      expect(mockSetUsername).toHaveBeenCalledWith('ogafan');
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
});

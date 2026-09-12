import { jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QuizScreen } from '@/components/quiz/QuizScreen';
import type { QuizAttempt, QuizEvent } from '@/services/quiz';
import { fetchQuizEvents, startQuizAttempt } from '@/services/quiz';
import { useQuizStore } from '@/stores/quiz-store';

jest.mock('@/components/quiz/QuizMusicPlayer', () => ({
  QuizMusicPlayer: () => null,
}));
jest.mock('@/components/quiz/QuizGameplayAdFooter', () => ({
  QuizGameplayAdFooter: () => null,
}));

let mockAuthUserId: string | null = 'quiz-shopper';

jest.mock('@/stores/auth-store', () => {
  const getState = () => ({
    customer: {
      id: 'customer-1',
      username: 'ogafan',
      date_of_birth: '1990-06-15',
    },
    user: mockAuthUserId ? { id: mockAuthUserId } : null,
  });
  const useAuthStore = (
    selector: (state: ReturnType<typeof getState>) => unknown
  ) => selector(getState());
  useAuthStore.getState = getState;
  return { useAuthStore };
});

jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/lib/get-quiz-device-fingerprint', () => ({
  getQuizDeviceFingerprint: jest.fn(async () => 'a'.repeat(64)),
}));
jest.mock('@/services/quiz', () => ({
  fetchQuizEvents: jest.fn(),
  startQuizAttempt: jest.fn(),
}));
jest.mock('@/services/quiz-attempts', () => ({
  createQuizStartRequestId: () => 'start-request-1',
  startQuizAttemptV2: jest.fn(),
  submitQuizAnswerV2: jest.fn(),
}));

const quizEventNow = Date.now();
const quizEvent: QuizEvent = {
  endsAt: new Date(quizEventNow + 15 * 60 * 1000).toISOString(),
  id: 'event-1',
  prizeName: 'N50,000 store credit',
  questionCount: 3,
  startsAt: new Date(quizEventNow + 10 * 60 * 1000).toISOString(),
  status: 'scheduled',
  title: 'Daily Prize Quiz',
};

describe('QuizScreen waiting room and sign-in gate', () => {
  beforeEach(() => {
    useQuizStore.getState().reset();
    mockAuthUserId = 'quiz-shopper';
    jest.clearAllMocks();
    jest.mocked(fetchQuizEvents).mockResolvedValue([quizEvent]);
    jest.mocked(startQuizAttempt).mockResolvedValue({
      attemptId: 'attempt-1',
      eventId: 'event-1',
    } as QuizAttempt);
  });

  it('emphasizes sign in instead of starting a quiz for a signed-out shopper', async () => {
    mockAuthUserId = null;
    const onSignIn = jest.fn();

    render(
      <QuizScreen integrityTier="device" locale="en-US" onSignIn={onSignIn} />
    );

    const signInButton = await screen.findByRole('button', {
      name: 'Sign in to play',
    });
    fireEvent.press(signInButton);

    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('We couldn’t start the quiz')).toBeNull();
    expect(screen.queryByRole('header', { name: 'How to play' })).toBeNull();
    expect(startQuizAttempt).not.toHaveBeenCalled();
  });

  it('opens a waiting room for scheduled quiz events', async () => {
    render(<QuizScreen integrityTier="device" locale="en-US" />);

    const waitingRoomButton = await screen.findByRole('button', {
      name: 'Enter waiting room Daily Prize Quiz',
    });
    expect(waitingRoomButton.props.accessibilityState).toMatchObject({
      disabled: false,
    });

    fireEvent.press(waitingRoomButton);
    fireEvent.press(
      screen.getByRole('checkbox', { name: 'Accept quiz rules and terms' })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Accept and play quiz' })
    );
    expect(screen.getByText('SuperQuiz waiting room')).toBeTruthy();
    expect(startQuizAttempt).not.toHaveBeenCalled();
  });

  it('refreshes the lobby from the pull-to-refresh callback', async () => {
    render(<QuizScreen integrityTier="device" locale="en-US" />);

    const eventList = await screen.findByLabelText('Available quiz events');
    await act(async () => {
      await eventList.props.onRefresh();
    });

    expect(fetchQuizEvents).toHaveBeenCalledTimes(2);
  });
});

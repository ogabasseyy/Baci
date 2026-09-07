import { jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import QuizRoute from '@/app/quiz';
import Colors from '@/constants/Colors';
import {
  fetchQuizEvents,
  type QuizEvent,
  startQuizAttempt,
  submitQuizAnswer,
} from '@/services/quiz';
import { useQuizStore } from '@/stores/quiz-store';

jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
  };
});
jest.mock('@/components/quiz/QuizMusicPlayer', () => ({
  QuizMusicPlayer: () => null,
}));
const mockQuizEventNow = Date.now();
const mockEvents: QuizEvent[] = [
  {
    id: 'event-1',
    title: 'Daily Prize Quiz',
    prizeName: 'N50,000 store credit',
    startsAt: new Date(mockQuizEventNow - 60 * 1000).toISOString(),
    endsAt: new Date(mockQuizEventNow + 10 * 60 * 1000).toISOString(),
    status: 'open',
    questionCount: 3,
  },
];

const mockCreateFutureDeadline = (secondsFromNow: number) =>
  new Date(Date.now() + secondsFromNow * 1000).toISOString();

const mockCreateQuizAttempt = () => ({
  attemptId: 'attempt-1',
  eventId: 'event-1',
  examPassPointsSpent: 1,
  remainingLoyaltyPoints: 4,
  question: {
    deadlineAt: mockCreateFutureDeadline(30),
    id: 'question-1',
    prompt: 'What is 2 + 2?',
    options: [
      { id: 'a', label: '3' },
      { id: 'b', label: '4' },
    ],
    timeLimitSeconds: 30,
    index: 1,
    total: 3,
  },
});

jest.mock('expo-router', () => {
  const { Text, View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Stack: {
      Screen: ({
        options,
      }: {
        options: { title: string; headerRight?: () => React.ReactNode };
      }) => (
        <View>
          <Text accessibilityRole="header">{options.title}</Text>
          {options.headerRight?.()}
        </View>
      ),
    },
    useIsFocused: jest.fn(() => false),
    useRouter: () => ({ push: jest.fn() }),
  };
});
jest.mock('@react-native-vector-icons/ionicons', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return function MockIonicons({
    color,
    name,
  }: {
    color?: string;
    name: string;
  }) {
    return (
      <Text accessibilityLabel={`icon:${name}`} style={{ color }}>
        {name}
      </Text>
    );
  };
});
jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
}));
jest.mock('@/components/quiz/QuizMusicPlayer', () => ({
  QuizMusicPlayer: () => null,
}));
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual<
    typeof import('react-native-safe-area-context')
  >('react-native-safe-area-context');
  return {
    ...actual,
    useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
  };
});

// This route test exercises the start flow directly, so the customer already
// has a username AND a date of birth — the username and 18+ date-of-birth gates
// are covered by components/quiz/QuizScreen.test.tsx, useQuizStartGate.test.ts,
// and useQuizDateOfBirthGate.test.ts.
jest.mock('@/stores/auth-store', () => {
  const getState = () => ({
    customer: {
      id: 'customer-1',
      username: 'ogafan',
      date_of_birth: '1990-06-15',
    },
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

jest.mock('@/services/quiz', () => ({
  fetchQuizEvents: jest.fn(async () => mockEvents),
  startQuizAttempt: jest.fn(async () => mockCreateQuizAttempt()),
  submitQuizAnswer: jest.fn(async () => ({
    attemptId: 'attempt-1',
    status: 'completed',
    correctAnswers: 1,
    totalQuestions: 3,
    prizeEligible: true,
  })),
}));

describe('/quiz screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useQuizStore.getState().reset();
    jest.mocked(fetchQuizEvents).mockResolvedValue(mockEvents);
    jest
      .mocked(startQuizAttempt)
      .mockImplementation(async () => mockCreateQuizAttempt());
    jest.mocked(submitQuizAnswer).mockResolvedValue({
      attemptId: 'attempt-1',
      status: 'completed',
      correctAnswers: 1,
      totalQuestions: 3,
      prizeEligible: true,
    });
  });

  async function acceptRulesAndStart() {
    fireEvent.press(
      await screen.findByRole('button', {
        name: 'Play for free Daily Prize Quiz',
      })
    );
    fireEvent.press(
      screen.getByRole('checkbox', { name: 'Accept quiz rules and terms' })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Accept and play quiz' })
    );
  }

  it('renders an accessible event list and start CTA', async () => {
    render(<QuizRoute />);

    expect(
      await screen.findByRole('header', { name: 'SuperQuiz' })
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', {
        name: 'Play for free Daily Prize Quiz',
      })
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        'Quiz event Daily Prize Quiz, prize N50,000 store credit'
      )
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('icon:podium-outline')).toHaveStyle({
      color: Colors.light.primary,
    });
  });

  it('starts the selected event and renders accessible answer controls', async () => {
    render(<QuizRoute />);

    await acceptRulesAndStart();

    expect(await screen.findByLabelText('Question 1 of 3')).toHaveProp(
      'accessibilityRole',
      'progressbar'
    );
    expect(screen.getByRole('button', { name: 'Answer 4' })).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Answer 4' }));
    fireEvent.press(screen.getByRole('button', { name: 'Submit answer' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Quiz result: 1 of 3 correct')).toHaveProp(
        'accessibilityRole',
        'alert'
      );
    });
  });

  it('renders an accessible empty state when there are no quiz events', async () => {
    jest.mocked(fetchQuizEvents).mockResolvedValueOnce([]);

    render(<QuizRoute />);

    expect(
      await screen.findByText('No quiz events available.')
    ).toBeOnTheScreen();
  });

  it('renders an accessible error when loading events fails', async () => {
    jest
      .mocked(fetchQuizEvents)
      .mockRejectedValueOnce(new Error('Events unavailable'));

    render(<QuizRoute />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Events unavailable'
    );
  });

  it('renders an accessible error when starting an event fails', async () => {
    jest
      .mocked(startQuizAttempt)
      .mockRejectedValueOnce(new Error('Start unavailable'));

    render(<QuizRoute />);

    await acceptRulesAndStart();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Start unavailable'
    );
  });

  it('renders an accessible error when submitting an answer fails', async () => {
    jest
      .mocked(submitQuizAnswer)
      .mockRejectedValueOnce(new Error('Submit unavailable'));

    render(<QuizRoute />);

    await acceptRulesAndStart();
    fireEvent.press(await screen.findByRole('button', { name: 'Answer 4' }));
    fireEvent.press(screen.getByRole('button', { name: 'Submit answer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Submit unavailable'
    );
  });
});

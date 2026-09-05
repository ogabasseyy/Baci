import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QuizEventsList } from './QuizEventsList';
import { createQuizLobbyStyles } from './QuizLobby.styles';
import type { QuizThemeColors } from './QuizScreen.styles';

jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@react-native-vector-icons/ionicons', () => 'Ionicons');
jest.mock('../storefront/GadgetPatternBackground', () => ({
  GadgetPatternBackground: () => null,
}));

const themeColors: QuizThemeColors = {
  background: '#fff',
  border: '#ddd',
  card: '#fff',
  error: '#dc2626',
  muted: '#e5e7eb',
  primary: '#dc2626',
  primaryLowOpacity: 'rgba(220, 38, 38, 0.1)',
  primaryForeground: '#fff',
  success: '#16a34a',
  text: '#111827',
  textSecondary: '#6b7280',
  warning: '#f59e0b',
};

describe('QuizEventsList', () => {
  it('resumes the existing attempt without opening rules or starting another attempt', () => {
    const onResume = jest.fn();
    const onStart = jest.fn();
    render(
      <QuizEventsList
        events={[
          {
            id: 'resume',
            title: 'Resume me',
            prizeName: 'Phone',
            startsAt: null,
            endsAt: null,
            status: 'active',
            questionCount: 5,
          },
        ]}
        isStarting={false}
        onStart={onStart}
        onResume={onResume}
        resumeEventId="resume"
        styles={createQuizLobbyStyles(themeColors)}
      />
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Resume quiz Resume me' })
    );
    expect(onResume).toHaveBeenCalledWith('resume');
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.queryByRole('header', { name: 'How to play' })).toBeNull();
  });
  it('refreshes the lobby when the player pulls down', () => {
    const onRefresh = jest.fn<() => Promise<void>>(async () => undefined);
    render(
      <QuizEventsList
        events={[]}
        fetchEvents={jest.fn(async () => [])}
        isStarting={false}
        onRefresh={onRefresh}
        onStart={jest.fn()}
        styles={createQuizLobbyStyles(themeColors)}
      />
    );

    const list = screen.getByLabelText('Available quiz events');
    expect(list.props.onRefresh).toEqual(expect.any(Function));
    fireEvent(list, 'refresh');

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders open events and triggers start callback', () => {
    const onStart = jest.fn();
    render(
      <QuizEventsList
        events={[
          {
            id: 'event-1',
            title: 'Open Quiz',
            prizeName: 'Smartphone',
            startsAt: null,
            endsAt: null,
            status: 'active',
            questionCount: 10,
            mode: 'test',
            timePerQuestionSeconds: 10,
            timeZone: 'Africa/Lagos',
          },
        ]}
        fetchEvents={jest.fn(async () => [])}
        isStarting={false}
        onStart={onStart}
        styles={createQuizLobbyStyles(themeColors)}
        resumeEventId="event-1"
      />
    );

    expect(screen.getByTestId('quiz-gadget-pattern-background')).toBeTruthy();
    expect(screen.getByText("OGABASSEY'S SUPERQUIZ")).toBeTruthy();
    expect(screen.getByText('Play for more than the prize.')).toBeTruthy();
    expect(screen.getByText(/within reach of more Nigerians/i)).toBeTruthy();
    expect(screen.getByText(/close the digital divide/i)).toBeTruthy();

    fireEvent.press(screen.getByLabelText(/Play for free Open Quiz/i));
    expect(screen.queryByLabelText(/Resume quiz Open Quiz/i)).toBeNull();
    expect(screen.getByRole('header', { name: 'How to play' })).toBeTruthy();
    fireEvent.press(
      screen.getByRole('checkbox', { name: 'Accept quiz rules and terms' })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Accept and play quiz' })
    );

    expect(onStart).toHaveBeenCalledWith('event-1', true);
  });

  it('offers scheduled events as waiting rooms', () => {
    const onStart = jest.fn();
    render(
      <QuizEventsList
        events={[
          {
            id: 'event-2',
            title: 'Scheduled Quiz',
            prizeName: 'Tablet',
            serverNow: '2099-01-01T00:00:00.000Z',
            startsAt: '2099-01-01T00:10:00.000Z',
            endsAt: null,
            status: 'scheduled',
            questionCount: 5,
          },
        ]}
        fetchEvents={jest.fn(async () => [])}
        isStarting={false}
        onStart={onStart}
        styles={createQuizLobbyStyles(themeColors)}
      />
    );

    const enterWaitingRoom = screen.getByLabelText(
      'Enter waiting room Scheduled Quiz'
    );
    expect(enterWaitingRoom.props.accessibilityState).toEqual({
      disabled: false,
    });
    fireEvent.press(enterWaitingRoom);
    expect(screen.getByRole('header', { name: 'How to play' })).toBeTruthy();
    fireEvent.press(
      screen.getByRole('checkbox', { name: 'Accept quiz rules and terms' })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Accept and play quiz' })
    );
    expect(screen.getByText('SuperQuiz waiting room')).toBeTruthy();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('keeps the programme purpose visible when no quiz is available', () => {
    render(
      <QuizEventsList
        events={[]}
        fetchEvents={jest.fn(async () => [])}
        isStarting={false}
        onStart={jest.fn()}
        styles={createQuizLobbyStyles(themeColors)}
      />
    );

    expect(screen.getByText("OGABASSEY'S SUPERQUIZ")).toBeTruthy();
    expect(screen.getByText('No quiz events available.')).toBeTruthy();
  });
});

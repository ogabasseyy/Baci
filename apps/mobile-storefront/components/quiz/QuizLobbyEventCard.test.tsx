import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createQuizLobbyStyles } from './QuizLobby.styles';
import { QuizLobbyEventCard } from './QuizLobbyEventCard';
import type { QuizThemeColors } from './QuizScreen.styles';

jest.mock('expo-image', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    Image: ({
      autoplay,
      accessibilityLabel,
    }: {
      autoplay?: boolean;
      accessibilityLabel?: string;
    }) =>
      React.createElement(View, {
        accessibilityLabel,
        accessibilityRole: 'image',
        accessible: true,
        autoplay,
      } as never),
  };
});
jest.mock('@react-native-vector-icons/ionicons', () => 'Ionicons');

const colors: QuizThemeColors = {
  background: '#000',
  border: '#222',
  card: '#111',
  error: '#f00',
  muted: '#555',
  primary: '#f90',
  primaryLowOpacity: '#321',
  primaryForeground: '#000',
  success: '#0f8',
  text: '#fff',
  textSecondary: '#aaa',
  warning: '#fb0',
};

describe('QuizLobbyEventCard', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the product spotlight and universal close timing once', () => {
    const onOpenRules = jest.fn();
    render(
      <QuizLobbyEventCard
        event={{
          endsAt: '2026-08-03T20:05:00Z',
          id: 'event-1',
          mode: 'test',
          prizeName: 'iPhone XR',
          questionCount: 20,
          prizeProduct: {
            condition: 'open_box',
            id: 'p1',
            imageUrl: 'https://example.com/xr.png',
            name: 'iPhone XR',
            variantId: null,
          },
          startsAt: '2026-08-03T20:00:00Z',
          status: 'active',
          timePerQuestionSeconds: 10,
          timeZone: 'Africa/Lagos',
          title: 'Redmi Warriors',
        }}
        isResume={false}
        isStarting={false}
        onOpenRules={onOpenRules}
        onResume={jest.fn()}
        serverNow="2026-08-03T20:04:30Z"
        styles={createQuizLobbyStyles(colors)}
      />
    );

    expect(screen.getByText('Win iPhone XR')).toBeTruthy();
    expect(screen.getByText("Tonight's Prize")).toBeTruthy();
    expect(screen.getByText('open box')).toBeTruthy();
    expect(screen.getByText('20 questions')).toBeTruthy();
    expect(screen.getByText('10s each')).toBeTruthy();
    expect(screen.getByText('until quiz ends')).toBeTruthy();
    expect(screen.queryByText('until entries close')).toBeNull();
    fireEvent.press(
      screen.getByRole('button', { name: 'Play for free Redmi Warriors' })
    );
    expect(onOpenRules).toHaveBeenCalledWith(true);
  });

  describe('bugfix: animated quiz prize images', () => {
    it('does not autoplay prize product images', () => {
      render(
        <QuizLobbyEventCard
          event={{
            endsAt: null,
            id: 'event-1',
            prizeName: 'iPhone XR',
            questionCount: 5,
            prizeProduct: {
              condition: null,
              id: 'p1',
              imageUrl: 'https://example.com/xr.gif',
              name: 'iPhone XR',
              variantId: null,
            },
            startsAt: null,
            status: 'active',
            title: 'Prize quiz',
          }}
          isResume={false}
          isStarting={false}
          onOpenRules={jest.fn()}
          onResume={jest.fn()}
          styles={createQuizLobbyStyles(colors)}
        />
      );

      expect(
        screen.getByRole('image', { name: 'iPhone XR prize image' }).props
          .autoplay
      ).toBe(false);
    });
  });

  it.each([
    'active',
    'closed',
    'finalizing',
    'completed',
    'cancelled',
  ] as const)('recovers a retained %s attempt without requesting another acceptance gate', (status) => {
    const onOpenRules = jest.fn();
    const onResume = jest.fn();
    render(
      <QuizLobbyEventCard
        event={{
          endsAt: null,
          id: 'event-1',
          prizeName: 'Phone',
          questionCount: 5,
          startsAt: null,
          status,
          title: 'Live quiz',
        }}
        isResume
        isStarting={false}
        onOpenRules={onOpenRules}
        onResume={onResume}
        styles={createQuizLobbyStyles(colors)}
      />
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Resume quiz Live quiz' })
    );
    expect(onOpenRules).not.toHaveBeenCalled();
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it.each([
    false,
    true,
  ])('closes entries at zero while retaining recovery access: %s', (isResume) => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-09T18:00:00.000Z'));
    const onExpire = jest.fn<() => void>();
    const onResume = jest.fn();

    render(
      <QuizLobbyEventCard
        event={{
          endsAt: '2026-08-09T18:00:01.000Z',
          id: 'event-expiring',
          prizeName: 'iPhone XR',
          questionCount: 5,
          startsAt: '2026-08-09T17:50:00.000Z',
          status: 'active',
          timePerQuestionSeconds: 10,
          timeZone: 'Africa/Lagos',
          title: 'Expiring quiz',
        }}
        isResume={isResume}
        isStarting={false}
        onExpire={onExpire}
        onOpenRules={jest.fn()}
        onResume={onResume}
        serverNow="2026-08-09T18:00:00.000Z"
        styles={createQuizLobbyStyles(colors)}
      />
    );

    expect(
      screen.getByRole('button', {
        name: `${isResume ? 'Resume quiz' : 'Play for free'} Expiring quiz`,
      })
    ).toBeTruthy();

    act(() => jest.advanceTimersByTime(1000));

    expect(screen.queryByText('until quiz ends')).toBeNull();
    expect(screen.queryByText('LIVE')).toBeNull();
    expect(screen.getByText('QUIZ')).toBeTruthy();
    expect(screen.queryByText(/^Closes /)).toBeNull();
    expect(screen.getByText(/^Closed /)).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: `${isResume ? 'Resume quiz' : 'Closed'} Expiring quiz`,
      }).props.accessibilityState
    ).toEqual({ disabled: !isResume });
    expect(onExpire).toHaveBeenCalledTimes(1);
    fireEvent.press(
      screen.getByRole('button', {
        name: `${isResume ? 'Resume quiz' : 'Closed'} Expiring quiz`,
      })
    );
    expect(onResume).toHaveBeenCalledTimes(isResume ? 1 : 0);
  });
});

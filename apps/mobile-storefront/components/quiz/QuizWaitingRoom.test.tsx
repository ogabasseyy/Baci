import { describe, expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { maybeShowQuizStartInterstitial } from '@/lib/quiz-start-interstitial';
import type { QuizEvent } from '@/services/quiz-types';
import { QuizWaitingRoom } from './QuizWaitingRoom';

jest.mock('@/lib/quiz-start-interstitial', () => ({
  maybeShowQuizStartInterstitial: jest.fn(async () => 'skipped'),
  setQuizRewardedFlowActive: jest.fn(),
}));

const mockMaybeShowQuizStartInterstitial = jest.mocked(
  maybeShowQuizStartInterstitial
);

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff',
      border: '#ddd',
      card: '#fff',
      error: '#f00',
      muted: '#aaa',
      primary: '#f90',
      primaryLowOpacity: '#321',
      primaryForeground: '#000',
      success: '#0f8',
      text: '#111',
      textSecondary: '#666',
      warning: '#fb0',
    },
  }),
}));

jest.mock('@/components/ads/AdSlot', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    AdSlot: ({ placement }: { placement: string }) =>
      React.createElement(View, { testID: `ad-slot-${placement}` }),
  };
});

function countTestIdOccurrences(testID: string): number {
  let count = 0;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const record = node as {
      children?: unknown;
      props?: { testID?: unknown };
    };
    if (record.props?.testID === testID) count += 1;
    if (record.children !== undefined) walk(record.children);
  };
  walk(screen.toJSON());
  return count;
}

const scheduled: QuizEvent = {
  endsAt: '2099-01-01T01:10:00.000Z',
  id: 'event-1',
  prizeName: 'Phone',
  questionCount: 10,
  startsAt: '2099-01-01T01:00:00.000Z',
  status: 'scheduled',
  title: 'Noon Quiz',
  serverNow: '2099-01-01T00:59:00.000Z',
  timePerQuestionSeconds: 10,
};

describe('QuizWaitingRoom', () => {
  it('renders event details and leaves on request', () => {
    const onExit = jest.fn();
    render(
      <QuizWaitingRoom
        event={scheduled}
        onExit={onExit}
        onStart={jest.fn()}
        refresh={jest.fn(async () => [scheduled])}
      />
    );
    expect(screen.getByText('Noon Quiz')).toBeTruthy();
    expect(screen.getByText('Win Phone')).toBeTruthy();
    expect(screen.getByText('10 questions')).toBeTruthy();
    expect(
      screen.getByLabelText('Waiting room for Noon Quiz').props.edges
    ).toBeUndefined();
    const scrollView = screen.getByLabelText('Scrollable waiting room');
    expect(scrollView.props.keyboardShouldPersistTaps).toBe('handled');
    expect(scrollView.props.showsVerticalScrollIndicator).toBe(false);
    expect(scrollView.props.contentContainerStyle).toEqual(
      expect.objectContaining({ flexGrow: 1, paddingBottom: 40 })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Leave waiting room' }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('opens the rules without an acceptance gate', () => {
    render(
      <QuizWaitingRoom
        event={scheduled}
        onExit={jest.fn()}
        onStart={jest.fn()}
        refresh={jest.fn(async () => [scheduled])}
      />
    );
    fireEvent.press(screen.getByRole('button', { name: 'View rules' }));
    expect(screen.getByRole('header', { name: 'How to play' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Close rules' }));
    expect(screen.queryByRole('header', { name: 'How to play' })).toBeNull();
  });

  it('keeps a single footer ad slot while the rules modal is open', () => {
    // Regression: the waiting-room FOOTER_ANCHOR must unmount while the
    // modal's own slot is visible so only one banner request is live.
    // The modal renders in a separate root outside query traversal, so
    // count across the full rendered tree instead of getAllByTestId.
    render(
      <QuizWaitingRoom
        event={scheduled}
        onExit={jest.fn()}
        onStart={jest.fn()}
        refresh={jest.fn(async () => [scheduled])}
      />
    );
    expect(countTestIdOccurrences('ad-slot-FOOTER_ANCHOR')).toBe(1);
    fireEvent.press(screen.getByRole('button', { name: 'View rules' }));
    expect(screen.getByRole('header', { name: 'How to play' })).toBeTruthy();
    expect(countTestIdOccurrences('ad-slot-FOOTER_ANCHOR')).toBe(1);
    fireEvent.press(screen.getByRole('button', { name: 'Close rules' }));
    expect(countTestIdOccurrences('ad-slot-FOOTER_ANCHOR')).toBe(1);
  });

  it('withholds the footer slot while a fullscreen ad owns the screen', async () => {
    // Regression: a presented pre-quiz interstitial covers the lobby, so
    // FOOTER_ANCHOR must unmount until it closes instead of requesting
    // underneath it.
    mockMaybeShowQuizStartInterstitial.mockResolvedValueOnce('shown');
    render(
      <QuizWaitingRoom
        event={scheduled}
        onExit={jest.fn()}
        onStart={jest.fn()}
        refresh={jest.fn(async () => [scheduled])}
      />
    );
    expect(countTestIdOccurrences('ad-slot-FOOTER_ANCHOR')).toBe(1);
    await waitFor(() => {
      expect(countTestIdOccurrences('ad-slot-FOOTER_ANCHOR')).toBe(0);
    });
    const onClosed =
      mockMaybeShowQuizStartInterstitial.mock.calls.at(-1)?.[0]?.onClosed;
    expect(typeof onClosed).toBe('function');
    act(() => {
      onClosed?.();
    });
    expect(countTestIdOccurrences('ad-slot-FOOTER_ANCHOR')).toBe(1);
  });
});

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBack } = vi.hoisted(() => ({ mockBack: vi.fn() }));

vi.mock('expo-router', () => ({
  Stack: {
    Screen: ({
      options,
    }: {
      options: { title: string; headerLeft: () => React.ReactNode };
    }) => (
      <header>
        <h1>{options.title}</h1>
        {options.headerLeft()}
      </header>
    ),
  },
  useRouter: () => ({ back: mockBack }),
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: ({ name }: { name: string }) => <span>{name}</span>,
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: { background: '#000', text: '#fff' } }),
}));

vi.mock('@/components/feedback/FeedbackForm', () => ({
  FeedbackForm: ({
    screen: reportedScreen,
    showTitle,
    onCancel,
    onSent,
  }: {
    screen: string | null;
    showTitle?: boolean;
    onCancel: () => void;
    onSent: () => void;
  }) => (
    <div>
      <span>
        form for {reportedScreen} title {String(showTitle)}
      </span>
      <button onClick={onCancel} type="button">
        cancel form
      </button>
      <button onClick={onSent} type="button">
        finish form
      </button>
    </div>
  ),
}));

import SendFeedbackScreen from './send-feedback';

beforeEach(() => {
  mockBack.mockReset();
  vi.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

describe('SendFeedbackScreen', () => {
  it('renders the shared form without a duplicate heading', () => {
    render(<SendFeedbackScreen />);

    expect(
      screen.getByText('form for /send-feedback title false')
    ).toBeInTheDocument();
  });

  it('shows the Send Feedback header with a back arrow', () => {
    render(<SendFeedbackScreen />);

    expect(
      screen.getByRole('heading', { name: 'Send Feedback' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Go back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('goes back when cancelled', () => {
    render(<SendFeedbackScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'cancel form' }));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('thanks the merchant and goes back once they dismiss the alert', () => {
    render(<SendFeedbackScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'finish form' }));

    const [title, , buttons] = vi.mocked(Alert.alert).mock.calls[0] ?? [];
    expect(title).toBe('Thanks for the feedback');
    expect(mockBack).not.toHaveBeenCalled();
    buttons?.[0]?.onPress?.();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBack } = vi.hoisted(() => ({ mockBack: vi.fn() }));

vi.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: { background: '#000' } }),
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

import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pathname, sentCallbacks } = vi.hoisted(() => ({
  pathname: { current: '/orders' },
  sentCallbacks: [] as Array<() => void>,
}));

vi.mock('expo-router', () => ({ usePathname: () => pathname.current }));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: { card: '#111', border: '#222', text: '#fff' },
    shadows: { md: {} },
  }),
}));

vi.mock('@/components/ui/AppSheetModal', () => ({
  AppSheetModal: ({
    children,
    visible,
  }: {
    children: ReactNode;
    visible: boolean;
  }) => (visible ? <div role="dialog">{children}</div> : null),
}));

vi.mock('./FeedbackForm', () => ({
  FeedbackForm: ({
    screen: reportedScreen,
    onCancel,
    onSent,
  }: {
    screen: string | null;
    onCancel: () => void;
    onSent: () => void;
  }) => {
    sentCallbacks.push(onSent);
    return (
      <div>
        <span>form for {reportedScreen}</span>
        <button onClick={onCancel} type="button">
          cancel form
        </button>
        <button onClick={onSent} type="button">
          finish form
        </button>
      </div>
    );
  },
}));

import { FeedbackLauncher } from './FeedbackLauncher';

const bugButton = () => screen.getByRole('button', { name: 'Send feedback' });

beforeEach(() => {
  pathname.current = '/orders';
  sentCallbacks.length = 0;
  vi.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

describe('FeedbackLauncher', () => {
  it('starts closed with only the bug button visible', () => {
    render(<FeedbackLauncher />);

    expect(bugButton()).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the sheet for the screen the merchant is on', () => {
    render(<FeedbackLauncher />);

    fireEvent.click(bugButton());

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('form for /orders')).toBeInTheDocument();
  });

  it('closes without a confirmation when cancelled', () => {
    render(<FeedbackLauncher />);
    fireEvent.click(bugButton());

    fireEvent.click(screen.getByRole('button', { name: 'cancel form' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('closes and thanks the merchant after sending', () => {
    render(<FeedbackLauncher />);
    fireEvent.click(bugButton());

    fireEvent.click(screen.getByRole('button', { name: 'finish form' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Thanks for the feedback',
      'The Baci team will look into it.'
    );
  });

  it('keeps a reopened sheet open when an earlier dismissed send completes', () => {
    render(<FeedbackLauncher />);
    fireEvent.click(bugButton());
    const staleOnSent = sentCallbacks.at(-1);
    fireEvent.click(screen.getByRole('button', { name: 'cancel form' }));
    fireEvent.click(bugButton());

    act(() => staleOnSent?.());

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Thanks for the feedback',
      'The Baci team will look into it.'
    );
  });
});

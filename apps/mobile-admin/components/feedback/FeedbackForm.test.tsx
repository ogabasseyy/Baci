import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSend, mockCollect } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockCollect: vi.fn(),
}));

vi.mock('@/lib/feedback-report', () => ({
  collectFeedbackDiagnostics: mockCollect,
  sendFeedbackReport: mockSend,
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      text: '#fff',
      textSecondary: '#999',
      textOnPrimary: '#fff',
      placeholder: '#999',
      inputBg: '#222',
      primary: '#4a90d9',
      cardHover: '#333',
      error: '#f00',
    },
  }),
}));

import { FeedbackForm } from './FeedbackForm';

function renderForm(props: Partial<Parameters<typeof FeedbackForm>[0]> = {}) {
  const onCancel = vi.fn();
  const onSent = vi.fn();
  render(
    <FeedbackForm
      onCancel={onCancel}
      onSent={onSent}
      screen="/orders"
      {...props}
    />
  );
  return { onCancel, onSent };
}

const messageBox = () => screen.getByLabelText('Feedback message');
const sendButton = () => screen.getByRole('button', { name: 'Send' });

beforeEach(() => {
  mockSend.mockReset();
  mockCollect.mockReset();
  mockCollect.mockReturnValue({ screen: '/orders', platform: 'ios' });
});

describe('FeedbackForm', () => {
  it('shows the heading by default and hides it on request', () => {
    const { unmount } = render(
      <FeedbackForm onCancel={vi.fn()} onSent={vi.fn()} screen={null} />
    );
    expect(
      screen.getByRole('heading', { name: 'Send feedback' })
    ).toBeInTheDocument();
    unmount();

    renderForm({ showTitle: false });
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('keeps Send disabled until a non-blank message is typed', () => {
    renderForm();
    expect(sendButton()).toHaveAttribute('aria-disabled', 'true');

    fireEvent.change(messageBox(), { target: { value: '   ' } });
    expect(sendButton()).toHaveAttribute('aria-disabled', 'true');

    fireEvent.change(messageBox(), { target: { value: 'Orders froze' } });
    expect(sendButton()).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('sends the message with the screen diagnostics and reports success', async () => {
    mockSend.mockResolvedValue({ id: 'fb-1', emailed: true });
    const { onSent } = renderForm();

    fireEvent.change(messageBox(), { target: { value: 'Orders froze' } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(mockCollect).toHaveBeenCalledWith('/orders');
    expect(mockSend).toHaveBeenCalledWith('Orders froze', {
      screen: '/orders',
      platform: 'ios',
    });
  });

  it('shows the server error and keeps the message when sending fails', async () => {
    mockSend.mockRejectedValue(
      new Error('You have sent a lot of feedback recently. Try again later.')
    );
    const { onSent } = renderForm();

    fireEvent.change(messageBox(), { target: { value: 'Orders froze' } });
    fireEvent.click(sendButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You have sent a lot of feedback recently. Try again later.'
    );
    expect(onSent).not.toHaveBeenCalled();
    expect(messageBox()).toHaveValue('Orders froze');
  });

  it('falls back to a generic error for non-Error failures', async () => {
    mockSend.mockRejectedValue('offline');
    renderForm();

    fireEvent.change(messageBox(), { target: { value: 'x' } });
    fireEvent.click(sendButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not send feedback. Please try again.'
    );
  });

  it('calls onCancel from the Cancel button', () => {
    const { onCancel } = renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

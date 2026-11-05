import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatLauncher } from './ChatLauncher';

describe('ChatLauncher', () => {
  it('renders the open control and calls toggle', () => {
    const onToggle = vi.fn();
    render(
      <ChatLauncher
        isOpen={false}
        isSanta={false}
        proactiveMsg={null}
        buttonClasses="chat-button"
        onToggle={onToggle}
        onDismissSuggestion={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Toggle chat' }));

    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('calls toggle for the close control while chat is open', () => {
    const onToggle = vi.fn();
    render(
      <ChatLauncher
        isOpen
        isSanta={false}
        proactiveMsg={null}
        buttonClasses="chat-button"
        onToggle={onToggle}
        onDismissSuggestion={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Toggle chat' }));

    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('dismisses a proactive suggestion', () => {
    const onDismissSuggestion = vi.fn();
    render(
      <ChatLauncher
        isOpen={false}
        isSanta={false}
        proactiveMsg="Need help finding something?"
        buttonClasses="chat-button"
        onToggle={vi.fn()}
        onDismissSuggestion={onDismissSuggestion}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss chat suggestion' }));

    expect(onDismissSuggestion).toHaveBeenCalledOnce();
  });

  it('shows Santa wish text when Santa mode is active', () => {
    render(
      <ChatLauncher
        isOpen={false}
        isSanta
        proactiveMsg={null}
        buttonClasses="chat-button"
        onToggle={vi.fn()}
        onDismissSuggestion={vi.fn()}
      />,
    );

    expect(screen.getByText(/Make a wish/)).toBeInTheDocument();
  });
});

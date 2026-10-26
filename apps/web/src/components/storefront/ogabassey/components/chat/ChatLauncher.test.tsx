import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatLauncher } from './ChatLauncher';
import type { useChatLauncherDrag } from './use-chat-launcher-drag';

const emptyDrag = {
  buttonProps: {},
} as ReturnType<typeof useChatLauncherDrag>;

describe('ChatLauncher', () => {
  it('renders and forwards activation for the standard launcher', () => {
    const onClick = vi.fn();
    render(
      <ChatLauncher
        isOpen={false}
        isSanta={false}
        proactiveMsg={null}
        setProactiveMsg={vi.fn()}
        onClick={onClick}
        drag={emptyDrag}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Toggle chat' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it('renders the Santa launcher and the open-state close icon', () => {
    const { rerender } = render(
      <ChatLauncher
        isOpen={false}
        isSanta
        proactiveMsg={null}
        setProactiveMsg={vi.fn()}
        onClick={vi.fn()}
        drag={emptyDrag}
      />,
    );
    expect(screen.getByRole('img', { name: 'Santa' })).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();

    rerender(
      <ChatLauncher
        isOpen
        isSanta={false}
        proactiveMsg={null}
        setProactiveMsg={vi.fn()}
        onClick={vi.fn()}
        drag={emptyDrag}
      />,
    );
    expect(screen.queryByRole('img', { name: 'Santa' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle chat' })).toHaveClass(
      'ogabassey-chat-button--open',
    );
  });

  it('dismisses the proactive message without activating chat', () => {
    const onClick = vi.fn();
    const setProactiveMsg = vi.fn();
    render(
      <ChatLauncher
        isOpen={false}
        isSanta={false}
        proactiveMsg="Need help?"
        setProactiveMsg={setProactiveMsg}
        onClick={onClick}
        drag={emptyDrag}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss chat message' }),
    );
    expect(setProactiveMsg).toHaveBeenCalledWith(null);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('announces arrow-key movement as a launcher shortcut', () => {
    render(
      <ChatLauncher
        isOpen={false}
        isSanta={false}
        proactiveMsg={null}
        setProactiveMsg={vi.fn()}
        onClick={vi.fn()}
        drag={emptyDrag}
      />,
    );

    const launcher = screen.getByRole('button', { name: 'Toggle chat' });
    expect(launcher).toHaveAttribute(
      'aria-keyshortcuts',
      'ArrowUp ArrowDown ArrowLeft ArrowRight',
    );
    expect(launcher).toHaveAccessibleDescription(
      'Use arrow keys to move the assistant launcher. Hold Shift for 48-pixel steps.',
    );
    expect(
      launcher.contains(
        screen.getByText(/Use arrow keys to move the assistant launcher/),
      ),
    ).toBe(false);
  });
});

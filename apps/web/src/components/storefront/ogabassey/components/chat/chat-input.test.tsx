import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInput } from './chat-input';

describe('ChatInput', () => {
  const defaultProps = {
    input: '',
    setInput: vi.fn(),
    isLoading: false,
    isSanta: false,
    onSubmit: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a text input', () => {
    render(<ChatInput {...defaultProps} />);
    const input = screen.getByRole('textbox');
    expect(input).toBeDefined();
  });

  it('renders a submit button', () => {
    render(<ChatInput {...defaultProps} />);
    const button = screen.getByRole('button', { name: 'Send message' });
    expect(button).toBeDefined();
  });

  it('labels the private destination action in Santa theme', () => {
    render(
      <ChatInput
        {...defaultProps}
        isSanta
        privateMode
        input="Lagos"
      />
    );

    expect(
      screen.getByRole('button', { name: 'Check destination state' })
    ).toBeDefined();
  });

  it('displays placeholder "Type your message..." in standard mode', () => {
    render(<ChatInput {...defaultProps} isSanta={false} />);
    const input = screen.getByPlaceholderText('Type your message...');
    expect(input).toBeDefined();
  });

  it('displays placeholder "Tell Santa your wish..." in santa mode', () => {
    render(<ChatInput {...defaultProps} isSanta={true} />);
    const input = screen.getByPlaceholderText('Tell Santa your wish...');
    expect(input).toBeDefined();
  });

  it('submit button is disabled when input is empty', () => {
    render(<ChatInput {...defaultProps} input="" />);
    const button = screen.getByRole('button', { name: 'Send message' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('submit button is disabled when loading is true', () => {
    render(<ChatInput {...defaultProps} input="some text" isLoading={true} />);
    const button = screen.getByRole('button', { name: 'Send message' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('submit button is enabled when input has text and not loading', () => {
    render(<ChatInput {...defaultProps} input="hello there" isLoading={false} />);
    const button = screen.getByRole('button', { name: 'Send message' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('input is disabled when isLoading is true', () => {
    render(<ChatInput {...defaultProps} isLoading={true} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('keeps suggested actions out of the composer', () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.queryByText('Track my order')).toBeNull();
    expect(screen.queryByText('Contact support')).toBeNull();
  });

  it('calls onSubmit when the form is submitted via button click', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const user = userEvent.setup();
    render(
      <ChatInput
        {...defaultProps}
        input="hello"
        onSubmit={onSubmit}
      />
    );
    const button = screen.getByRole('button', { name: 'Send message' });
    await user.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('calls onSubmit when Enter key is pressed in the input', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const user = userEvent.setup();
    render(
      <ChatInput
        {...defaultProps}
        input="hello"
        onSubmit={onSubmit}
      />
    );
    const input = screen.getByRole('textbox');
    await user.type(input, '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('calls setInput when user types in the text input', async () => {
    const setInput = vi.fn();
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} setInput={setInput} />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'a');
    expect(setInput).toHaveBeenCalledWith('a');
  });

  it('reflects the current input value in the text field', () => {
    render(<ChatInput {...defaultProps} input="current value" />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('current value');
  });
});

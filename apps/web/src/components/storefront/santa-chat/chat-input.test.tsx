import { fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatInput } from './chat-input';

describe('ChatInput hydration stability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('personalizes placeholder after deterministic initial render', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const serverHtml = renderToString(
      <ChatInput isLoading={false} onSendMessage={vi.fn()} />
    );
    const serverText = serverHtml
      .replace(/<[^>]+>/g, '')
      .replaceAll('\u00a0', ' ');

    expect(serverText).toContain('Share your Christmas wish...');
    expect(random).not.toHaveBeenCalled();

    render(<ChatInput isLoading={false} onSendMessage={vi.fn()} />);

    expect(screen.getByRole('textbox').parentElement).toHaveTextContent(
      'Type your letter to Santa...'
    );
    expect(random).toHaveBeenCalledOnce();
  });
});

describe('ChatInput Enter to send', () => {
  it('sends the message on a plain Enter', () => {
    const onSendMessage = vi.fn();
    render(<ChatInput isLoading={false} onSendMessage={onSendMessage} />);
    const textbox = screen.getByRole('textbox');

    fireEvent.change(textbox, { target: { value: 'A bike please' } });
    fireEvent.keyDown(textbox, { key: 'Enter' });

    expect(onSendMessage).toHaveBeenCalledWith({ content: 'A bike please' });
  });

  it('does not send while an IME composition is confirming with Enter', () => {
    const onSendMessage = vi.fn();
    render(<ChatInput isLoading={false} onSendMessage={onSendMessage} />);
    const textbox = screen.getByRole('textbox');

    fireEvent.change(textbox, { target: { value: 'じてんしゃ' } });
    // Cancelled, so a surrounding form cannot submit implicitly.
    expect(
      fireEvent.keyDown(textbox, { key: 'Enter', isComposing: true })
    ).toBe(false);
    // Safari reports the confirming Enter as keyCode 229 with isComposing false.
    fireEvent.keyDown(textbox, { key: 'Enter', keyCode: 229 });

    expect(onSendMessage).not.toHaveBeenCalled();
    expect(textbox).toHaveValue('じてんしゃ');
  });
});

describe('ChatInput auto-sizing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('leaves sizing to CSS when field-sizing is supported', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    render(<ChatInput isLoading={false} onSendMessage={vi.fn()} />);
    const textbox = screen.getByRole('textbox');

    fireEvent.change(textbox, { target: { value: 'line one' } });

    expect(textbox).toHaveClass('field-sizing-content');
    expect(textbox.style.height).toBe('');
  });

  it('measures the content when field-sizing is unsupported', () => {
    vi.stubGlobal('CSS', { supports: () => false });
    render(<ChatInput isLoading={false} onSendMessage={vi.fn()} />);
    const textbox = screen.getByRole('textbox');
    Object.defineProperty(textbox, 'scrollHeight', {
      configurable: true,
      value: 72,
    });

    fireEvent.change(textbox, { target: { value: 'line one' } });

    expect(textbox.style.height).toBe('72px');
  });
});

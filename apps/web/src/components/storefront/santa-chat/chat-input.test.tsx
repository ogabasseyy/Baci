import { render, screen } from '@testing-library/react';
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

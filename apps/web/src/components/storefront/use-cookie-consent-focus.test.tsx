import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { useCookieConsentFocus } from './use-cookie-consent-focus';

function ConsentFocusHarness() {
  const [visible, setVisible] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const focus = useCookieConsentFocus(visible);

  return (
    <>
      <div className="ogabassey-chat-anchor">
        <button type="button">Assistant launcher</button>
        {chatOpen && (
          <div className="ogabassey-chat-window">
            <button type="button">Chat input</button>
            <button type="button" onClick={() => setChatOpen(false)}>
              Close conversation
            </button>
          </div>
        )}
      </div>
      <button type="button" onClick={() => setChatOpen(true)}>
        Open chat
      </button>
      <button type="button" onClick={() => setVisible(true)}>
        Show consent
      </button>
      {visible && (
        <div
          ref={focus.bannerRef}
          role="dialog"
          onFocusCapture={focus.onFocusCapture}
          onBlurCapture={focus.onBlurCapture}
        >
          <button
            type="button"
            onClick={focus.dismissWithFocus(() => setVisible(false))}
          >
            Dismiss consent
          </button>
        </div>
      )}
    </>
  );
}

it('restores the covered launcher after consent closes from inside the banner', () => {
  render(<ConsentFocusHarness />);
  const launcher = screen.getByRole('button', { name: 'Assistant launcher' });
  launcher.focus();
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));

  const dismiss = screen.getByRole('button', { name: 'Dismiss consent' });
  expect(dismiss).toHaveFocus();
  fireEvent.click(dismiss);

  expect(launcher).toHaveFocus();
});

it('moves focus to consent when an open chat covering it closes', async () => {
  render(<ConsentFocusHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
  const chatInput = screen.getByRole('button', { name: 'Chat input' });
  chatInput.focus();
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));
  expect(chatInput).toHaveFocus();

  fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(screen.getByRole('button', { name: 'Dismiss consent' })).toHaveFocus();
});

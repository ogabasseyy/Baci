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
        <button
          type="button"
          className="ogabassey-chat-button"
          onClick={() => setChatOpen((open) => !open)}
        >
          Assistant launcher
        </button>
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
  screen.getByRole('button', { name: 'Chat input' }).focus();
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));
  expect(screen.getByRole('button', { name: 'Chat input' })).toHaveFocus();

  fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const dismiss = screen.getByRole('button', { name: 'Dismiss consent' });
  expect(dismiss).toHaveFocus();
  fireEvent.click(dismiss);
  expect(
    screen.getByRole('button', { name: 'Assistant launcher' })
  ).toHaveFocus();
});

it('moves focus to consent when the launcher toggle closes an open chat', async () => {
  render(<ConsentFocusHarness />);
  const launcher = screen.getByRole('button', { name: 'Assistant launcher' });
  fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
  launcher.focus();
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));
  expect(launcher).toHaveFocus();

  fireEvent.click(launcher);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const dismiss = screen.getByRole('button', { name: 'Dismiss consent' });
  expect(dismiss).toHaveFocus();
  fireEvent.click(dismiss);
  expect(launcher).toHaveFocus();
});

it('moves focus to consent when an open chat closes without holding focus', async () => {
  render(<ConsentFocusHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));
  expect(document.activeElement).toBe(document.body);

  fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(screen.getByRole('button', { name: 'Dismiss consent' })).toHaveFocus();
});

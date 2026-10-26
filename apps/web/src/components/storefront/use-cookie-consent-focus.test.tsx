import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { useCookieConsentFocus } from './use-cookie-consent-focus';

function ConsentFocusHarness() {
  const [visible, setVisible] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [runtimeMounted, setRuntimeMounted] = useState(false);
  const [showNewsletter, setShowNewsletter] = useState(false);
  const focus = useCookieConsentFocus(visible);

  return (
    <>
      <div
        className="ogabassey-chat-anchor"
        style={showNewsletter ? { display: 'none' } : undefined}
      >
        <button
          key={runtimeMounted ? 'runtime' : 'deferred'}
          type="button"
          className="ogabassey-chat-button"
          onClick={() => setChatOpen((open) => !open)}
        >
          {runtimeMounted ? 'Runtime launcher' : 'Assistant launcher'}
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
      <button type="button" onClick={() => setRuntimeMounted(true)}>
        Mount chat runtime
      </button>
      <button type="button" onClick={() => setShowNewsletter(true)}>
        Show newsletter
      </button>
      {showNewsletter && (
        <div className="ogabassey-newsletter-popup">
          <button type="button">Close newsletter</button>
        </div>
      )}
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
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Dismiss consent' })
    ).toHaveFocus()
  );
  const dismiss = screen.getByRole('button', { name: 'Dismiss consent' });
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
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Dismiss consent' })
    ).toHaveFocus()
  );
  const dismiss = screen.getByRole('button', { name: 'Dismiss consent' });
  fireEvent.click(dismiss);
  expect(launcher).toHaveFocus();
});

it('moves focus to consent when an open chat closes without holding focus', async () => {
  render(<ConsentFocusHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));
  expect(document.activeElement).toBe(document.body);

  fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Dismiss consent' })
    ).toHaveFocus()
  );
});

it('observes chat opened after consent appears', async () => {
  render(<ConsentFocusHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
  screen.getByRole('button', { name: 'Chat input' }).focus();
  await act(async () => Promise.resolve());
  fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Dismiss consent' })
    ).toHaveFocus()
  );
});

it('restores focus to the live launcher after deferred runtime handoff', () => {
  render(<ConsentFocusHarness />);
  screen.getByRole('button', { name: 'Assistant launcher' }).focus();
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mount chat runtime' }));

  const dismiss = screen.getByRole('button', { name: 'Dismiss consent' });
  dismiss.focus();
  fireEvent.click(dismiss);

  expect(
    screen.getByRole('button', { name: 'Runtime launcher' })
  ).toHaveFocus();
});

it('scopes consent mutations to the chat anchor parent', () => {
  const observe = vi.spyOn(MutationObserver.prototype, 'observe');
  render(<ConsentFocusHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));

  const anchor = document.querySelector('.ogabassey-chat-anchor');
  expect(anchor).not.toBeNull();
  expect(observe).toHaveBeenCalledWith(anchor?.parentElement, {
    childList: true,
    subtree: true,
  });
  observe.mockRestore();
});

it('restores focus to a visible promotion if CSS hides the launcher', () => {
  render(<ConsentFocusHarness />);
  screen.getByRole('button', { name: 'Assistant launcher' }).focus();
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show newsletter' }));
  const dismiss = screen.getByRole('button', { name: 'Dismiss consent' });
  dismiss.focus();
  fireEvent.click(dismiss);

  expect(
    screen.getByRole('button', { name: 'Close newsletter' })
  ).toHaveFocus();
});

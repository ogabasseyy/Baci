import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { useCookieConsentFocus } from './use-cookie-consent-focus';

function ConsentFocusHarness() {
  const [visible, setVisible] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [runtimeMounted, setRuntimeMounted] = useState(false);
  const [showNewsletter, setShowNewsletter] = useState(false);
  const [navigated, setNavigated] = useState(false);
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
            <button
              type="button"
              onClick={() => {
                setChatOpen(false);
                setNavigated(true);
                document.querySelector<HTMLElement>('h1')?.focus();
              }}
            >
              Navigate to repair
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
      <h1 tabIndex={-1}>Repair page</h1>
      {navigated && <p>Repair page loaded</p>}
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

it('does not steal focus when chat navigation closes while consent is pending', () => {
  render(<ConsentFocusHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
  screen.getByRole('button', { name: 'Chat input' }).focus();
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));
  expect(screen.getByRole('button', { name: 'Chat input' })).toHaveFocus();

  fireEvent.click(screen.getByRole('button', { name: 'Navigate to repair' }));
  expect(screen.getByRole('heading', { name: 'Repair page' })).toHaveFocus();
  expect(
    screen.getByRole('button', { name: 'Dismiss consent' })
  ).not.toHaveFocus();
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

it('does not redirect consent focus to chat after a non-chat popup interaction', () => {
  render(<ConsentFocusHarness />);
  const newsletter = screen.getByRole('button', { name: 'Show newsletter' });
  newsletter.focus();
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));
  fireEvent.focusIn(screen.getByRole('button', { name: 'Dismiss consent' }), {
    relatedTarget: newsletter,
  });

  const dismiss = screen.getByRole('button', { name: 'Dismiss consent' });
  fireEvent.click(dismiss);

  expect(newsletter).toHaveFocus();
});

it('restores focus to an ordinary control that was active before consent appeared', () => {
  render(<ConsentFocusHarness />);
  const newsletter = screen.getByRole('button', { name: 'Show newsletter' });
  newsletter.focus();
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));

  const dismiss = screen.getByRole('button', { name: 'Dismiss consent' });
  dismiss.focus();
  fireEvent.focusIn(dismiss, { relatedTarget: newsletter });
  fireEvent.click(dismiss);

  expect(newsletter).toHaveFocus();
});

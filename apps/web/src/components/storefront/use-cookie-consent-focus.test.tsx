import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { useCookieConsentFocus } from './use-cookie-consent-focus';

function ConsentFocusHarness() {
  const [visible, setVisible] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [runtimeMounted, setRuntimeMounted] = useState(false);
  const [showNewsletter, setShowNewsletter] = useState(false);
  const [hideLauncherButton, setHideLauncherButton] = useState(false);
  const [navigated, setNavigated] = useState(false);
  const focus = useCookieConsentFocus(visible);

  return (
    <>
      <div
        className="ogabassey-chat-anchor"
        style={showNewsletter ? { opacity: '0' } : undefined}
      >
        <button
          key={runtimeMounted ? 'runtime' : 'deferred'}
          type="button"
          className="ogabassey-chat-button"
          style={hideLauncherButton ? { visibility: 'hidden' } : undefined}
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
      <button type="button" onClick={() => setHideLauncherButton(true)}>
        Hide launcher button
      </button>
      <h1 tabIndex={-1}>Repair page</h1>
      {navigated && <p>Repair page loaded</p>}
      {showNewsletter && (
        <div className="ogabassey-newsletter-popup">
          <button
            type="button"
            aria-label="Dismiss newsletter popup backdrop"
            tabIndex={-1}
          >
            Backdrop
          </button>
          <button type="button" aria-label="Close newsletter">
            Close newsletter
          </button>
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
          <button type="button">Consent details</button>
          <button
            type="button"
            onClick={focus.dismissWithFocus(() => setVisible(false))}
          >
            Dismiss consent
          </button>
          <button
            type="button"
            onClick={focus.dismissWithFocus(() => {
              window.setTimeout(() => setVisible(false), 200);
            })}
          >
            Dismiss consent with exit animation
          </button>
        </div>
      )}
    </>
  );
}

it('does not steal chat launcher focus when non-modal consent appears', () => {
  render(<ConsentFocusHarness />);
  const launcher = screen.getByRole('button', { name: 'Assistant launcher' });
  launcher.focus();
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));

  const dismiss = screen.getByRole('button', { name: 'Dismiss consent' });
  expect(launcher).toHaveFocus();
  expect(dismiss).not.toHaveFocus();
});

it('restores chat launcher focus when consent closes after banner entry', () => {
  render(<ConsentFocusHarness />);
  const launcher = screen.getByRole('button', { name: 'Assistant launcher' });
  launcher.focus();
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));

  const dismiss = screen.getByRole('button', { name: 'Dismiss consent' });
  dismiss.focus();
  fireEvent.click(dismiss);

  expect(launcher).toHaveFocus();
});

it('falls back to the launcher when banner focus has no related target', () => {
  render(<ConsentFocusHarness />);
  const launcher = screen.getByRole('button', { name: 'Assistant launcher' });
  launcher.focus();
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));

  const dismiss = screen.getByRole('button', { name: 'Dismiss consent' });
  launcher.blur();
  dismiss.focus();
  fireEvent.focusIn(dismiss, { relatedTarget: null });
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

it('does not focus a hidden launcher button when consent closes', () => {
  render(<ConsentFocusHarness />);
  const launcher = screen.getByRole('button', { name: 'Assistant launcher' });
  launcher.focus();
  const focus = vi.spyOn(launcher, 'focus');
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));
  fireEvent.click(screen.getByRole('button', { name: 'Hide launcher button' }));
  const dismiss = screen.getByRole('button', { name: 'Dismiss consent' });
  dismiss.focus();
  fireEvent.click(dismiss);

  expect(focus).not.toHaveBeenCalled();
});

it('does not redirect consent focus to chat after a non-chat popup interaction', () => {
  render(<ConsentFocusHarness />);
  const newsletter = screen.getByRole('button', { name: 'Show newsletter' });
  newsletter.focus();
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));
  const dismiss = screen.getByRole('button', { name: 'Dismiss consent' });
  dismiss.focus();
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
  fireEvent.click(dismiss);

  expect(newsletter).toHaveFocus();
});

it('does not redirect focus to chat when consent started without a focus origin', () => {
  render(<ConsentFocusHarness />);
  document.body.tabIndex = -1;
  document.body.focus();
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));

  const dismiss = screen.getByRole('button', { name: 'Dismiss consent' });
  dismiss.focus();
  fireEvent.focusIn(dismiss, { relatedTarget: document.body });
  fireEvent.click(dismiss);

  expect(document.activeElement).toBe(document.body);
  expect(
    screen.getByRole('button', { name: 'Assistant launcher' })
  ).not.toHaveFocus();
  document.body.removeAttribute('tabindex');
});

it('keeps the original page control as origin while focus moves inside consent', () => {
  render(<ConsentFocusHarness />);
  const origin = screen.getByRole('button', { name: 'Show newsletter' });
  origin.focus();
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));

  screen.getByRole('button', { name: 'Consent details' }).focus();
  const dismiss = screen.getByRole('button', { name: 'Dismiss consent' });
  dismiss.focus();
  fireEvent.click(dismiss);

  expect(origin).toHaveFocus();
});

it('preserves newer outside focus while consent finishes its exit animation', () => {
  vi.useFakeTimers();
  render(<ConsentFocusHarness />);
  const origin = screen.getByRole('button', { name: 'Show newsletter' });
  origin.focus();
  fireEvent.click(screen.getByRole('button', { name: 'Show consent' }));

  const dismiss = screen.getByRole('button', {
    name: 'Dismiss consent with exit animation',
  });
  dismiss.focus();
  fireEvent.click(dismiss);
  origin.focus();
  act(() => vi.advanceTimersByTime(200));

  expect(origin).toHaveFocus();
  vi.useRealTimers();
});

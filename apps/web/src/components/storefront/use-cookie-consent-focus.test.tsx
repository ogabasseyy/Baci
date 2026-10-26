import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { useCookieConsentFocus } from './use-cookie-consent-focus';

function ConsentFocusHarness() {
  const [visible, setVisible] = useState(false);
  const focus = useCookieConsentFocus(visible);

  return (
    <>
      <div className="ogabassey-chat-anchor">
        <button type="button">Assistant launcher</button>
      </div>
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

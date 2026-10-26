import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { usePopupFocusManagement } from './use-popup-focus-management';

function Harness() {
  const [visible, setVisible] = useState(true);
  const { rememberPromotionFocus } = usePopupFocusManagement(visible, false);
  return (
    <>
      <div className="ogabassey-chat-anchor">
        <button className="ogabassey-chat-button">Assistant</button>
      </div>
      {visible && (
        <div className="promotion">
          <button
            onClick={() => {
              rememberPromotionFocus('.promotion');
              setVisible(false);
            }}
          >
            Close promotion
          </button>
        </div>
      )}
      <button>Page control</button>
    </>
  );
}

it('restores keyboard focus to chat after its promotion closes', () => {
  render(<Harness />);
  fireEvent.keyDown(document, { key: 'Tab' });
  screen.getByRole('button', { name: 'Close promotion' }).focus();
  fireEvent.click(screen.getByRole('button', { name: 'Close promotion' }));

  expect(screen.getByRole('button', { name: 'Assistant' })).toHaveFocus();
});

it('retries focus when removing a separate overlay reveals the launcher', async () => {
  function HiddenUntilBlockerLeaves() {
    const [visible, setVisible] = useState(true);
    const { rememberPromotionFocus } = usePopupFocusManagement(visible, false);
    return (
      <>
        <style>
          {'body:has(.ogabassey-offer-popup) .ogabassey-chat-anchor { display: none; }'}
        </style>
        {visible && (
          <div className="promotion">
            <button
              onClick={() => {
                rememberPromotionFocus('.promotion');
                setVisible(false);
              }}
            >
              Close promotion
            </button>
          </div>
        )}
        <div className="ogabassey-chat-anchor">
          <button className="ogabassey-chat-button">Assistant</button>
        </div>
      </>
    );
  }

  const blocker = document.createElement('div');
  blocker.className = 'ogabassey-offer-popup';
  document.body.append(blocker);
  render(<HiddenUntilBlockerLeaves />);
  fireEvent.keyDown(document, { key: 'Tab' });
  screen.getByRole('button', { name: 'Close promotion' }).focus();
  fireEvent.click(screen.getByRole('button', { name: 'Close promotion' }));

  const launcher = screen.getByRole('button', { name: 'Assistant', hidden: true });
  expect(launcher).not.toHaveFocus();
  blocker.remove();

  await waitFor(() => expect(launcher).toHaveFocus());
});

import { fireEvent, render, screen } from '@testing-library/react';
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

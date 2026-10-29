import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

it('keeps focus restoration pending while the launcher is disabled', async () => {
  function DisabledLauncherUntilReady() {
    const [visible, setVisible] = useState(true);
    const [disabled, setDisabled] = useState(true);
    const { rememberPromotionFocus } = usePopupFocusManagement(visible, false);
    return (
      <>
        {visible && (
          <div className="promotion">
            <button
              onClick={() => {
                rememberPromotionFocus('.promotion');
                setVisible(false);
                setTimeout(() => setDisabled(false), 0);
              }}
            >
              Close promotion
            </button>
          </div>
        )}
        <div className="ogabassey-chat-anchor">
          <button className="ogabassey-chat-button" disabled={disabled}>
            Assistant
          </button>
        </div>
      </>
    );
  }

  render(<DisabledLauncherUntilReady />);
  fireEvent.keyDown(document, { key: 'Tab' });
  screen.getByRole('button', { name: 'Close promotion' }).focus();
  fireEvent.click(screen.getByRole('button', { name: 'Close promotion' }));

  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Assistant' })).toHaveFocus(),
  );
});

it('abandons a pending restore when another promotion replaces the dismissed one', async () => {
  function ReplacedPromotionHarness() {
    const [firstVisible, setFirstVisible] = useState(true);
    const [secondVisible, setSecondVisible] = useState(false);
    const [pageControlVisible, setPageControlVisible] = useState(true);
    const { rememberPromotionFocus } = usePopupFocusManagement(
      firstVisible,
      secondVisible,
    );

    return (
      <>
        <div className="ogabassey-chat-anchor" style={{ display: 'none' }}>
          <button className="ogabassey-chat-button">Assistant</button>
        </div>
        {firstVisible && (
          <div className="first-promotion">
            <button
              onClick={() => {
                rememberPromotionFocus('.first-promotion');
                setFirstVisible(false);
              }}
            >
              Close first promotion
            </button>
          </div>
        )}
        <button onClick={() => setSecondVisible(true)}>Show next promotion</button>
        {secondVisible && (
          <div className="second-promotion">
            <button onClick={() => setSecondVisible(false)}>
              Close next promotion
            </button>
          </div>
        )}
        {pageControlVisible && (
          <div>
            <button>Page control</button>
            <button onClick={() => setPageControlVisible(false)}>
              Navigate away
            </button>
          </div>
        )}
      </>
    );
  }

  render(<ReplacedPromotionHarness />);
  fireEvent.keyDown(document, { key: 'Tab' });
  const closeFirst = screen.getByRole('button', {
    name: 'Close first promotion',
  });
  closeFirst.focus();
  fireEvent.click(closeFirst);
  fireEvent.click(screen.getByRole('button', { name: 'Show next promotion' }));

  const pageControl = screen.getByRole('button', { name: 'Page control' });
  pageControl.focus();
  fireEvent.click(screen.getByRole('button', { name: 'Navigate away' }));
  expect(document.activeElement).not.toBe(pageControl);

  fireEvent.click(screen.getByRole('button', { name: 'Close next promotion' }));
  const anchor = document.querySelector<HTMLElement>('.ogabassey-chat-anchor');
  if (!anchor) throw new Error('Missing chat launcher anchor');
  anchor.style.display = '';
  await act(async () => {
    await Promise.resolve();
  });

  expect(screen.getByRole('button', { name: 'Assistant' })).not.toHaveFocus();
});

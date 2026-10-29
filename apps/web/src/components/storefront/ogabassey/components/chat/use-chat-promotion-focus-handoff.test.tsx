import { fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useChatPromotionFocusHandoff } from './use-chat-promotion-focus-handoff';

function HandoffHarness() {
  useChatPromotionFocusHandoff();
  return (
    <>
      <div className="ogabassey-chat-anchor">
        <button className="ogabassey-chat-button" type="button">
          Assistant
        </button>
      </div>
      <button type="button">Page control</button>
      <div className="ogabassey-newsletter-popup">
        <button type="button">Newsletter control</button>
      </div>
    </>
  );
}

afterEach(() => {
  delete document.body.dataset.chatPromotionFocusHandoff;
});

it('marks only a keyboard Tab handoff from the launcher to an unrelated page control', () => {
  render(<HandoffHarness />);
  const launcher = document.querySelector('.ogabassey-chat-button');
  const pageControl = document.querySelector('button:not(.ogabassey-chat-button)');
  if (!(launcher instanceof HTMLButtonElement)) throw new Error('Missing launcher');
  if (!(pageControl instanceof HTMLButtonElement)) throw new Error('Missing page control');

  fireEvent.keyDown(launcher, { key: 'Tab' });
  fireEvent.focusIn(pageControl);

  expect(document.body.dataset.chatPromotionFocusHandoff).toBe('true');
});

it('does not suppress promotions for a non-Tab key or focus inside a promotion', () => {
  render(<HandoffHarness />);
  const launcher = document.querySelector('.ogabassey-chat-button');
  const promotionControl = document.querySelector(
    '.ogabassey-newsletter-popup button'
  );
  if (!(launcher instanceof HTMLButtonElement)) throw new Error('Missing launcher');
  if (!(promotionControl instanceof HTMLButtonElement))
    throw new Error('Missing newsletter control');

  fireEvent.keyDown(launcher, { key: 'ArrowDown' });
  fireEvent.focusIn(promotionControl);
  expect(document.body.dataset.chatPromotionFocusHandoff).toBeUndefined();

  fireEvent.keyDown(launcher, { key: 'Tab' });
  fireEvent.focusIn(promotionControl);
  expect(document.body.dataset.chatPromotionFocusHandoff).toBeUndefined();
});

it('clears a handoff on pointer interaction and when the hook unmounts', () => {
  const { unmount } = render(<HandoffHarness />);
  const launcher = document.querySelector('.ogabassey-chat-button');
  const pageControl = document.querySelector('button:not(.ogabassey-chat-button)');
  if (!(launcher instanceof HTMLButtonElement)) throw new Error('Missing launcher');
  if (!(pageControl instanceof HTMLButtonElement)) throw new Error('Missing page control');

  fireEvent.keyDown(launcher, { key: 'Tab' });
  fireEvent.focusIn(pageControl);
  fireEvent.pointerDown(launcher);
  expect(document.body.dataset.chatPromotionFocusHandoff).toBe('true');

  fireEvent.pointerDown(pageControl);
  expect(document.body.dataset.chatPromotionFocusHandoff).toBeUndefined();

  fireEvent.keyDown(launcher, { key: 'Tab' });
  fireEvent.focusIn(pageControl);
  unmount();
  expect(document.body.dataset.chatPromotionFocusHandoff).toBeUndefined();
});

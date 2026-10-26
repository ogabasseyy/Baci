import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dragTestSupport from './use-chat-launcher-drag.test-support';

const { Harness, setup } = dragTestSupport;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('launcher viewport changes while chat is open', () => {
  it('batches rapid window resize re-clamps into one animation frame', () => {
    const view = setup();

    act(() => {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
    });

    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(view.measure).not.toHaveBeenCalled();
    view.flush();
    expect(view.measure).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('preserves the saved closed position through a temporary viewport shrink', () => {
    const viewport = Object.assign(new EventTarget(), {
      offsetLeft: 0,
      offsetTop: 0,
      width: 320,
      height: 480,
    }) as unknown as VisualViewport;
    vi.stubGlobal('visualViewport', viewport);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320);
    const view = setup();
    view.pointer('pointerdown', 220, 320);
    view.pointer('pointermove', 2000, 2000);
    view.pointer('pointerup', 2000, 2000);
    const saved = screen.getByTestId('anchor').style.transform;
    expect(saved).toBe('translate3d(248px, 358px, 0)');

    view.rerender(<Harness open />);
    Object.defineProperty(viewport, 'height', { configurable: true, value: 300 });
    act(() => viewport.dispatchEvent(new Event('resize')));
    view.flush();
    Object.defineProperty(viewport, 'height', { configurable: true, value: 480 });
    view.rerender(<Harness />);

    expect(screen.getByTestId('anchor').style.transform).toBe(saved);
    view.unmount();
  });

  it('moves the focused launcher with arrow keys', () => {
    const { button } = setup();
    fireEvent.keyDown(button, { key: 'ArrowLeft' });
    expect(screen.getByTestId('anchor').style.transform).toBe(
      'translate3d(184px, 300px, 0)',
    );
  });

  it('preserves browser shortcuts when arrow keys have modifiers', () => {
    const { button } = setup();
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowLeft',
      altKey: true,
    });
    button.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByTestId('anchor').style.transform).toBe('');
  });
});

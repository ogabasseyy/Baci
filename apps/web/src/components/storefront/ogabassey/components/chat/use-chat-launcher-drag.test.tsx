import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChatLauncherDrag } from './use-chat-launcher-drag';

function Harness({ open = false, onRender = () => {}, onOpen = () => {} }) {
  const drag = useChatLauncherDrag(undefined, open);
  onRender();
  return (
    <div ref={drag.anchorRef} style={drag.anchorStyle} data-testid="anchor">
      <button
        type="button"
        {...drag.buttonProps}
        onClick={() => {
          if (!drag.suppressClick()) onOpen();
        }}
      >
        Chat
      </button>
    </div>
  );
}

function setup() {
  let frame: FrameRequestCallback | undefined;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
    frame = undefined;
  });
  const onRender = vi.fn();
  const onOpen = vi.fn();
  const view = render(<Harness onRender={onRender} onOpen={onOpen} />);
  const button = screen.getByRole('button', { name: 'Chat' });
  const measure = vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
    left: 200,
    top: 300,
    width: 56,
    height: 56,
    right: 256,
    bottom: 356,
    x: 200,
    y: 300,
    toJSON: () => ({}),
  });
  const pointer = (type: string, x: number, y: number) =>
    fireEvent(
      button,
      Object.assign(
        new MouseEvent(type, {
          bubbles: true,
          clientX: x,
          clientY: y,
          button: 0,
        }),
        { pointerId: 1, isPrimary: true },
      ),
    );
  return {
    ...view,
    button,
    measure,
    onOpen,
    onRender,
    pointer,
    flush: () => act(() => frame?.(0)),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('useChatLauncherDrag', () => {
  it('batches movement into a transform without rendering React or reading layout per move', () => {
    const { pointer, flush, onRender, measure } = setup();
    pointer('pointerdown', 220, 320);
    const renders = onRender.mock.calls.length;
    pointer('pointermove', 120, 220);
    pointer('pointermove', 100, 200);
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    flush();
    expect(screen.getByTestId('anchor').style.transform).toBe(
      'translate3d(-120px, -120px, 0)',
    );
    expect(onRender).toHaveBeenCalledTimes(renders);
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it('keeps a dragged icon inside the viewport and suppresses the resulting click', () => {
    const { pointer, button, onOpen } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', -2000, -2000);
    pointer('pointerup', -2000, -2000);
    expect(screen.getByTestId('anchor').style.transform).toBe(
      'translate3d(16px, 16px, 0)',
    );
    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
    pointer('pointerdown', 20, 20);
    pointer('pointerup', 20, 20);
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('opens on a tap with small finger movement', () => {
    const { pointer, button, onOpen } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 222, 322);
    pointer('pointerup', 222, 322);
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByTestId('anchor').style.transform).toBe('');
  });

  it('keeps the icon reachable after the viewport shrinks', () => {
    const { pointer } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 2000, 2000);
    pointer('pointerup', 2000, 2000);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(480);
    fireEvent(window, new Event('resize'));
    expect(screen.getByTestId('anchor').style.transform).toBe(
      'translate3d(248px, 408px, 0)',
    );
  });

  it('keeps click suppression after pointer capture is released on pointerup', () => {
    const { pointer, button, onOpen } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 120, 220);
    pointer('pointerup', 120, 220);
    const lostCapture = new MouseEvent('lostpointercapture', { bubbles: true });
    Object.defineProperty(lostCapture, 'pointerId', { value: 1 });
    fireEvent(button, lostCapture);
    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('restores the previous transform when a drag is cancelled', () => {
    const { pointer, flush } = setup();
    const anchor = screen.getByTestId('anchor');
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 120, 220);
    flush();
    expect(anchor.style.transform).not.toBe('');
    pointer('pointercancel', 120, 220);
    expect(anchor.style.transform).toBe('');
  });

  it('does not replace the saved position with zero bounds while hidden', () => {
    const { pointer, measure } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 120, 220);
    pointer('pointerup', 120, 220);
    measure.mockReturnValue({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent(window, new Event('resize'));
    expect(screen.getByTestId('anchor').style.transform).toBe(
      'translate3d(100px, 200px, 0)',
    );
  });

  it('allows keyboard activation after a touch drag is cancelled', () => {
    const { pointer, button, onOpen } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 120, 220);
    pointer('pointercancel', 120, 220);
    fireEvent.click(button, { detail: 0 });
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('cancels queued animation work on unmount', () => {
    const { pointer, unmount } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 120, 220);
    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1);
  });
});

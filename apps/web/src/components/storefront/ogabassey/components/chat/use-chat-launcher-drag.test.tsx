import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import dragTestSupport from './use-chat-launcher-drag.test-support';

const { Harness, setup } = dragTestSupport;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
    const { pointer, click, onOpen } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', -2000, -2000);
    pointer('pointerup', -2000, -2000);
    expect(screen.getByTestId('anchor').style.transform).toBe(
      'translate3d(16px, 16px, 0)',
    );
    click(-2000, -2000);
    expect(onOpen).not.toHaveBeenCalled();
    pointer('pointerdown', 20, 20);
    pointer('pointerup', 20, 20);
    click(20, 20);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('uses pointerup coordinates when the last move event was missed', () => {
    const { pointer } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointerup', 120, 220);
    expect(screen.getByTestId('anchor').style.transform).toBe(
      'translate3d(100px, 200px, 0)',
    );
  });

  it('re-clamps when the delayed proactive bubble appears after chat closes', () => {
    const { pointer, rerender } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', -2000, -2000);
    pointer('pointerup', -2000, -2000);
    expect(screen.getByTestId('anchor').style.transform).toBe(
      'translate3d(16px, 16px, 0)',
    );

    rerender(<Harness open />);
    rerender(<Harness />);
    expect(screen.getByTestId('anchor').style.transform).toBe(
      'translate3d(16px, 16px, 0)',
    );
    rerender(
      <Harness
        hasOverflow
        onOverflowMount={(bubble) =>
          vi.spyOn(bubble, 'getBoundingClientRect').mockReturnValue({
            left: 100,
            top: 250,
            width: 192,
            height: 50,
            right: 292,
            bottom: 300,
            x: 100,
            y: 250,
            toJSON: () => ({}),
          })
        }
      />,
    );
    expect(screen.getByTestId('anchor').style.transform).toBe(
      'translate3d(116px, 66px, 0)',
    );
  });

  it('opens on a tap with small finger movement', () => {
    const { pointer, button, click, onOpen } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 222, 322);
    pointer('pointerup', 222, 322);
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByTestId('anchor').style.transform).toBe('');
  });

  it('keeps the icon reachable after the viewport shrinks', () => {
    const { pointer, measure, flush } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 2000, 2000);
    pointer('pointerup', 2000, 2000);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(480);
    fireEvent(window, new Event('resize'));
    flush();
    expect(screen.getByTestId('anchor').style.transform).toBe(
      'translate3d(248px, 358px, 0)',
    );
  });

  it('re-clamps against visual viewport size and offset changes', () => {
    const viewport = Object.assign(new EventTarget(), {
      offsetLeft: 0,
      offsetTop: 0,
      width: 320,
      height: 480,
    }) as unknown as VisualViewport;
    vi.stubGlobal('visualViewport', viewport);
    const setViewportValue = (key: keyof VisualViewport, value: number) =>
      Object.defineProperty(viewport, key, { configurable: true, value });
    const { pointer, flush } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 2000, 2000);
    pointer('pointerup', 2000, 2000);
    expect(screen.getByTestId('anchor').style.transform).toBe(
      'translate3d(248px, 374px, 0)',
    );

    setViewportValue('offsetLeft', 40);
    setViewportValue('offsetTop', 20);
    setViewportValue('width', 200);
    setViewportValue('height', 300);
    act(() => viewport.dispatchEvent(new Event('resize')));
    flush();
    expect(screen.getByTestId('anchor').style.transform).toBe(
      'translate3d(168px, 214px, 0)',
    );

    setViewportValue('offsetLeft', 200);
    setViewportValue('offsetTop', 200);
    act(() => viewport.dispatchEvent(new Event('scroll')));
    flush();
    expect(screen.getByTestId('anchor').style.transform).toBe(
      'translate3d(216px, 216px, 0)',
    );
  });

  it('keeps click suppression after pointer capture is released on pointerup', () => {
    const { pointer, button, click, onOpen } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 120, 220);
    pointer('pointerup', 120, 220);
    const lostCapture = new MouseEvent('lostpointercapture', { bubbles: true });
    Object.defineProperty(lostCapture, 'pointerId', { value: 1 });
    fireEvent(button, lostCapture);
    click(120, 220);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('commits a moved position and suppresses activation when capture is lost mid-drag', () => {
    const { pointer, click, onOpen } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 120, 220);
    pointer('lostpointercapture', 100, 180);

    expect(screen.getByTestId('anchor').style.transform).toBe(
      'translate3d(80px, 160px, 0)',
    );
    click(100, 180);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not swallow later keyboard activation when a drag emits no click', () => {
    vi.useFakeTimers();
    const { pointer, button, onOpen } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 120, 220);
    pointer('pointerup', 120, 220);
    vi.runOnlyPendingTimers();
    fireEvent.click(button, { detail: 0 });
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('suppresses a delayed pointer click after a completed drag', () => {
    vi.useFakeTimers();
    const { pointer, click, onOpen } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 120, 220);
    pointer('pointerup', 120, 220);
    vi.advanceTimersByTime(250);
    click(120, 220);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('allows a new pointerless activation after the drag-click grace period', () => {
    vi.useFakeTimers();
    const { pointer, click, onOpen } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 120, 220);
    pointer('pointerup', 120, 220);
    vi.advanceTimersByTime(350);
    click(120, 220);
    expect(onOpen).toHaveBeenCalledOnce();
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

  it('re-clamps a saved position when the hidden launcher becomes visible', () => {
    const { pointer, measure, notifyResizeObserver } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 2000, 2000);
    pointer('pointerup', 2000, 2000);
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
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(480);
    measure.mockReturnValue({
      left: 0,
      top: 0,
      width: 56,
      height: 56,
      right: 56,
      bottom: 56,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    notifyResizeObserver();
    expect(screen.getByTestId('anchor').style.transform).toBe(
      'translate3d(248px, 358px, 0)',
    );
  });

  it('keeps the icon above the device bottom safe area', () => {
    const { pointer } = setup();
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) =>
      (element instanceof HTMLDivElement && element.style.position === 'fixed'
        ? { height: '34px' }
        : pseudo === '::before'
          ? { height: '34px' }
        : {
            getPropertyValue: () =>
              'env(safe-area-inset-bottom, 0px)',
          }) as unknown as CSSStyleDeclaration,
    );
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 220, 5000);
    pointer('pointerup', 220, 5000);
    expect(screen.getByTestId('anchor').style.transform).toBe(
      'translate3d(200px, 662px, 0)',
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

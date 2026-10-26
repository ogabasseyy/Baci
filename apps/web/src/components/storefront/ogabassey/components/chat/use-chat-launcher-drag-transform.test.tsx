import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import dragTestSupport from './use-chat-launcher-drag.test-support';

const { setup } = dragTestSupport;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('writes the release transform when a drag returns to its saved position', () => {
  const { pointer, flush } = setup({ initialPosition: { x: 100, y: 200 } });
  pointer('pointerdown', 220, 320);
  pointer('pointermove', 320, 420);
  flush();
  expect(screen.getByTestId('anchor').style.transform).toBe(
    'translate3d(200px, 300px, 0)',
  );

  pointer('pointerup', 120, 220);
  expect(screen.getByTestId('anchor').style.transform).toBe(
    'translate3d(100px, 200px, 0)',
  );
});

it('skips viewport layout reads before the launcher has a saved position', () => {
  const viewport = Object.assign(new EventTarget(), {
    offsetLeft: 0,
    offsetTop: 0,
    width: 320,
    height: 480,
  }) as unknown as VisualViewport;
  vi.stubGlobal('visualViewport', viewport);
  const { measure, flush } = setup();
  const styleRead = vi.mocked(window.getComputedStyle);
  measure.mockClear();
  styleRead.mockClear();

  fireEvent(window, new Event('resize'));
  act(() => viewport.dispatchEvent(new Event('scroll')));
  flush();

  expect(measure).not.toHaveBeenCalled();
  expect(styleRead).not.toHaveBeenCalled();
});

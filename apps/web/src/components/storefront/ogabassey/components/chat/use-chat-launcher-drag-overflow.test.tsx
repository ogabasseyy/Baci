import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dragTestSupport from './use-chat-launcher-drag.test-support';

const { setup } = dragTestSupport;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('chat launcher overflow clamp', () => {
  it('keeps the launcher reachable when its bubble cannot fit in a narrow viewport', () => {
    const { pointer, button } = setup();
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(260);
    const bubble = document.createElement('div');
    bubble.dataset.chatLauncherOverflow = '';
    button.parentElement?.append(bubble);
    vi.spyOn(bubble, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 300,
      width: 320,
      height: 50,
      right: 320,
      bottom: 350,
      x: 0,
      y: 300,
      toJSON: () => ({}),
    });

    pointer('pointerdown', 220, 320);
    pointer('pointermove', -2000, 320);
    pointer('pointerup', -2000, 320);

    expect(screen.getByTestId('anchor').style.transform).toBe(
      'translate3d(0px, 300px, 0)',
    );
  });

  it.each([
    [
      'top-left',
      { left: 100, top: 250, width: 192, height: 50, right: 292, bottom: 300, x: 100, y: 250 },
      -2000,
      -2000,
      116,
      66,
    ],
    [
      'top-right',
      { left: 220, top: 250, width: 150, height: 50, right: 370, bottom: 300, x: 220, y: 250 },
      2000,
      -2000,
      134,
      66,
    ],
    [
      'bottom-left',
      { left: 100, top: 340, width: 150, height: 80, right: 250, bottom: 420, x: 100, y: 340 },
      -2000,
      2000,
      116,
      310,
    ],
    [
      'bottom-right',
      { left: 220, top: 340, width: 150, height: 80, right: 370, bottom: 420, x: 220, y: 340 },
      2000,
      2000,
      134,
      310,
    ],
  ] as const)(
    'keeps the proactive bubble inside the viewport at the %s clamp',
    (_corner, bubbleBounds, dragX, dragY, expectedX, expectedY) => {
      const { pointer, button } = setup();
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320);
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(480);
      const bubble = document.createElement('div');
      bubble.dataset.chatLauncherOverflow = '';
      button.parentElement?.append(bubble);
      vi.spyOn(bubble, 'getBoundingClientRect').mockReturnValue({
        ...bubbleBounds,
        toJSON: () => ({}),
      });
      pointer('pointerdown', 220, 320);
      pointer('pointermove', dragX, dragY);
      pointer('pointerup', dragX, dragY);
      expect(screen.getByTestId('anchor').style.transform).toBe(
        `translate3d(${expectedX}px, ${expectedY}px, 0)`,
      );
    },
  );
});

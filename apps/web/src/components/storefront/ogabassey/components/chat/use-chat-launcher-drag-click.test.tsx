import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import dragTestSupport from './use-chat-launcher-drag.test-support';

const { setup } = dragTestSupport;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('drag click sequencing', () => {
  it('suppresses a delayed synthetic click without expiring', () => {
    vi.useFakeTimers();
    const { pointer, button, onOpen } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 120, 220);
    pointer('pointerup', 120, 220);

    vi.advanceTimersByTime(10_000);
    fireEvent.click(button, { detail: 1 });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('allows the next genuine tap when a drag produced no click', () => {
    const { pointer, button, onOpen } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 120, 220);
    pointer('pointerup', 120, 220);

    pointer('pointerdown', 120, 220);
    pointer('pointerup', 120, 220);
    fireEvent.click(button, { detail: 1 });

    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('keeps the drag click suppressed after keyboard activation', () => {
    const { pointer, button, onOpen } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 120, 220);
    pointer('pointerup', 120, 220);
    fireEvent.click(button, { detail: 0 });
    fireEvent.click(button, { detail: 1 });

    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('allows a click after pointer cancellation', () => {
    const { pointer, button, onOpen } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 120, 220);
    pointer('pointercancel', 120, 220);
    fireEvent.click(button, { detail: 1 });

    expect(onOpen).toHaveBeenCalledOnce();
  });
});

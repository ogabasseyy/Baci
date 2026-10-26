import { afterEach, describe, expect, it, vi } from 'vitest';
import { setup } from './use-chat-launcher-drag.test-support';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useChatLauncherDrag click correlation', () => {
  it('allows an untrusted pointerId-zero assistive click after a pointerId-zero drag', () => {
    const { pointer, click, onOpen } = setup();
    pointer('pointerdown', 220, 320, 0);
    pointer('pointermove', 120, 220, 0);
    pointer('pointerup', 120, 220, 0);
    click(120, 220, 1, 0);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('allows a trusted pointerId-zero click after a nonzero-pointer drag', () => {
    const { pointer, trustedClick, onOpen } = setup();
    pointer('pointerdown', 220, 320, 7);
    pointer('pointermove', 120, 220, 7);
    pointer('pointerup', 120, 220, 7);
    trustedClick(120, 220, 0);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('allows an independent pointer-id-less click at the drag release point', () => {
    const { pointer, click, onOpen } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 120, 220);
    pointer('pointerup', 120, 220);
    click(120, 220, 1, null);
    expect(onOpen).toHaveBeenCalledOnce();

    click(120, 220);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('clears pointer-id-less suppression on a new interaction', () => {
    const { pointer, click, onOpen } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 120, 220);
    pointer('pointerup', 120, 220);
    pointer('pointerdown', 120, 220);
    pointer('pointerup', 120, 220);
    click(120, 220, 1, null);
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

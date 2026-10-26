import { afterEach, describe, expect, it, vi } from 'vitest';
import { setup } from './use-chat-launcher-drag.test-support';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useChatLauncherDrag click correlation', () => {
  it('suppresses a pointer-id-less compatibility click at the drag release point', () => {
    const { pointer, click, onOpen } = setup();
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 120, 220);
    pointer('pointerup', 120, 220);
    click(120, 220, 1, null);
    expect(onOpen).not.toHaveBeenCalled();
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

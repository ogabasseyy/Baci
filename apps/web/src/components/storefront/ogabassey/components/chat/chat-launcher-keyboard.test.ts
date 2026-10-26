import { describe, expect, it } from 'vitest';
import { getChatLauncherKeyboardPosition } from './chat-launcher-keyboard';

const icon = { width: 56, height: 56 };
const noOverflow = { left: 0, top: 0, right: 0, bottom: 0 };

describe('getChatLauncherKeyboardPosition', () => {
  it('moves 16px, or 48px with Shift, and ignores other keys', () => {
    expect(
      getChatLauncherKeyboardPosition(
        'ArrowRight',
        false,
        { x: 100, y: 120 },
        icon,
        0,
        0,
        noOverflow,
      ),
    ).toEqual({ x: 116, y: 120 });
    expect(
      getChatLauncherKeyboardPosition(
        'ArrowDown',
        true,
        { x: 100, y: 120 },
        icon,
        0,
        0,
        noOverflow,
      ),
    ).toEqual({ x: 100, y: 168 });
    expect(
      getChatLauncherKeyboardPosition(
        'Enter',
        false,
        { x: 100, y: 120 },
        icon,
        0,
        0,
        noOverflow,
      ),
    ).toBeNull();
  });
});

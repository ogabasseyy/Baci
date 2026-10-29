import { clampChatLauncherPosition } from './chat-launcher-geometry';
import type { Overflow, Position, SafeAreaEdges } from './chat-launcher-geometry';

const KEY_MOVEMENT = {
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
} as const;

function isMovementKey(key: string): key is keyof typeof KEY_MOVEMENT {
  return Object.hasOwn(KEY_MOVEMENT, key);
}

export function getChatLauncherKeyboardPosition(
  key: string,
  shiftKey: boolean,
  current: Position,
  rect: Pick<DOMRect, 'width' | 'height'>,
  bottomSafeArea: number,
  mobileOffset: number,
  overflow: Overflow,
  safeArea: SafeAreaEdges,
) {
  if (!isMovementKey(key)) return null;
  const movement = KEY_MOVEMENT[key];
  const step = shiftKey ? 48 : 16;
  return clampChatLauncherPosition(
    current.x + movement[0] * step,
    current.y + movement[1] * step,
    rect.width,
    rect.height,
    bottomSafeArea,
    mobileOffset,
    overflow,
    safeArea,
  );
}

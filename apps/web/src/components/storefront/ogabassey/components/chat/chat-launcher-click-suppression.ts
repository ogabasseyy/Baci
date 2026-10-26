import type { MouseEvent as ReactMouseEvent } from 'react';

export function isSuppressedChatLauncherDragClick(
  event: ReactMouseEvent<HTMLButtonElement>,
  pending: { pointerId: number; pointerType: string; x: number; y: number } | null,
) {
  // Pointerless clicks cannot be distinguished from independent assistive
  // activations, so only suppress browsers that report pointer correlation.
  const nativeEvent = event.nativeEvent as MouseEvent & {
    pointerId?: number;
    pointerType?: string;
  };
  const matchesRelease =
    pending &&
    event.detail > 0 &&
    Math.abs(event.clientX - pending.x) <= 2 &&
    Math.abs(event.clientY - pending.y) <= 2;
  const matchesPointer = Boolean(
    pending &&
      ((nativeEvent.pointerId === pending.pointerId &&
        (nativeEvent.pointerId !== 0 || nativeEvent.isTrusted)) ||
        (nativeEvent.pointerId === 0 &&
          pending.pointerType === 'touch' &&
          nativeEvent.pointerType === 'touch' &&
          nativeEvent.isTrusted)),
  );
  return Boolean(matchesRelease && matchesPointer);
}

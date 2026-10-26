import type { MouseEvent as ReactMouseEvent } from 'react';

export function clearChatLauncherDragClickOnNewInteraction(
  pending: { current: unknown | null },
) {
  pending.current = null;
}

export function isSuppressedChatLauncherDragClick(
  event: ReactMouseEvent<HTMLButtonElement>,
  pending: { pointerId: number; pointerType: string; x: number; y: number } | null,
) {
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
        (nativeEvent.pointerId !== 0 ||
          (nativeEvent.isTrusted &&
            nativeEvent.pointerType === pending.pointerType))) ||
        (nativeEvent.pointerId === 0 &&
          event.detail > 0 &&
          nativeEvent.isTrusted &&
          nativeEvent.pointerType === pending.pointerType)),
  );
  // Older engines dispatch a trusted MouseEvent for the compatibility click.
  // detail === 0 keyboard/AT activations stay independent of the drag token.
  const trustedPointerlessClick =
    nativeEvent.pointerId === undefined && nativeEvent.isTrusted;
  return Boolean(
    matchesRelease && (matchesPointer || trustedPointerlessClick),
  );
}

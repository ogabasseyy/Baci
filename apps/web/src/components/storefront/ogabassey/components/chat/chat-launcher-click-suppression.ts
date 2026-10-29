import type { MouseEvent as ReactMouseEvent } from 'react';

export const CHAT_LAUNCHER_DRAG_CLICK_MAX_DELAY_MS = 1_500;

export function clearChatLauncherDragClickOnNewInteraction(
  pending: { current: unknown | null },
) {
  pending.current = null;
}

export function isSuppressedChatLauncherDragClick(
  event: ReactMouseEvent<HTMLButtonElement>,
  pending:
    | {
        pointerId: number;
        pointerType: string;
        x: number;
        y: number;
        expiresAt: number;
      }
    | null,
) {
  const nativeEvent = event.nativeEvent as MouseEvent & {
    pointerId?: number;
    pointerType?: string;
  };
  const isFresh = pending !== null && Date.now() <= pending.expiresAt;
  const matchesRelease =
    isFresh &&
    pending &&
    event.detail > 0 &&
    Math.abs(event.clientX - pending.x) <= 2 &&
    Math.abs(event.clientY - pending.y) <= 2;
  const matchesPointer = Boolean(
    isFresh &&
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

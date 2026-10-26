import type { MouseEvent as ReactMouseEvent } from 'react';
import { describe, expect, it } from 'vitest';
import { isSuppressedChatLauncherDragClick } from './chat-launcher-click-suppression';

function clickEvent({
  detail = 1,
  pointerId,
  pointerType,
  isTrusted = true,
}: {
  detail?: number;
  pointerId?: number;
  pointerType?: string;
  isTrusted?: boolean;
} = {}) {
  return {
    clientX: 100,
    clientY: 200,
    detail,
    nativeEvent: {
      ...(pointerId === undefined ? {} : { pointerId }),
      ...(pointerType === undefined ? {} : { pointerType }),
      isTrusted,
    },
  } as unknown as ReactMouseEvent<HTMLButtonElement>;
}

const release = { pointerId: 7, pointerType: 'mouse', x: 100, y: 200 };

describe('chat launcher click suppression', () => {
  it('suppresses a release-correlated pointer click', () => {
    expect(
      isSuppressedChatLauncherDragClick(
        clickEvent({ pointerId: 7 }),
        release,
      ),
    ).toBe(true);
  });

  it('leaves keyboard activation independent', () => {
    expect(
      isSuppressedChatLauncherDragClick(
        clickEvent({ detail: 0 }),
        release,
      ),
    ).toBe(false);
  });

  it('allows an independent trusted pointerless activation', () => {
    expect(
      isSuppressedChatLauncherDragClick(clickEvent(), release),
    ).toBe(false);
  });

  it('suppresses Firefox touch clicks reported with pointer ID zero', () => {
    expect(
      isSuppressedChatLauncherDragClick(
        clickEvent({ pointerId: 0, pointerType: 'touch' }),
        { ...release, pointerType: 'touch' },
      ),
    ).toBe(true);
  });

  it('does not treat an unrelated pointer ID zero as a touch click', () => {
    expect(
      isSuppressedChatLauncherDragClick(
        clickEvent({ pointerId: 0, pointerType: 'mouse' }),
        release,
      ),
    ).toBe(false);
  });

  it('does not suppress a trusted pointer ID zero with a mismatched pointer type', () => {
    expect(
      isSuppressedChatLauncherDragClick(
        clickEvent({ pointerId: 0, pointerType: 'mouse' }),
        { ...release, pointerId: 0, pointerType: 'touch' },
      ),
    ).toBe(false);
  });
});

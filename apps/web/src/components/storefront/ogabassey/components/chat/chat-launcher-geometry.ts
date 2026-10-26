const EDGE_GAP = 16;

export type Position = { x: number; y: number };
export type Overflow = { left: number; top: number; right: number; bottom: number };

function clampAxis(value: number, min: number, max: number, fallback: number) {
  return min <= max
    ? Math.max(min, Math.min(value, max))
    : Math.max(0, Math.min(value, fallback));
}

export function clampChatLauncherPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  bottomSafeArea = 0,
  overflow: Overflow = { left: 0, top: 0, right: 0, bottom: 0 },
): Position {
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const minX = viewportLeft + EDGE_GAP + overflow.left;
  const maxX = viewportLeft + viewportWidth - width - EDGE_GAP - overflow.right;
  const minY = viewportTop + EDGE_GAP + overflow.top;
  const maxY =
    viewportTop +
    viewportHeight -
    height -
    EDGE_GAP -
    bottomSafeArea -
    overflow.bottom;

  return {
    x: clampAxis(x, minX, maxX, viewportLeft + viewportWidth - width),
    y: clampAxis(
      y,
      minY,
      maxY,
      viewportTop + viewportHeight - height - bottomSafeArea,
    ),
  };
}

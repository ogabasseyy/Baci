export interface ScrollHeaderVisibilityInput {
  currentOffsetY: number;
  previousOffsetY: number;
  isVisible: boolean;
  maximumOffsetY?: number;
  directionThreshold?: number;
  revealThreshold?: number;
}

export interface ScrollHeaderVisibilityResult {
  isVisible: boolean;
  previousOffsetY: number;
}

const DEFAULT_DIRECTION_THRESHOLD = 12;
const DEFAULT_REVEAL_THRESHOLD = 20;

export function resolveScrollHeaderVisibility({
  currentOffsetY,
  previousOffsetY,
  isVisible,
  maximumOffsetY = Number.POSITIVE_INFINITY,
  directionThreshold = DEFAULT_DIRECTION_THRESHOLD,
  revealThreshold = DEFAULT_REVEAL_THRESHOLD,
}: ScrollHeaderVisibilityInput): ScrollHeaderVisibilityResult {
  if (
    !Number.isFinite(currentOffsetY) ||
    currentOffsetY < 0 ||
    currentOffsetY > maximumOffsetY
  )
    return { isVisible, previousOffsetY };
  const nextOffsetY = Math.max(0, currentOffsetY);

  if (nextOffsetY <= revealThreshold) {
    return {
      isVisible: true,
      previousOffsetY: nextOffsetY,
    };
  }

  const deltaY = nextOffsetY - previousOffsetY;

  if (Math.abs(deltaY) < directionThreshold) {
    return {
      isVisible,
      previousOffsetY,
    };
  }

  return {
    isVisible: deltaY < 0,
    previousOffsetY: nextOffsetY,
  };
}

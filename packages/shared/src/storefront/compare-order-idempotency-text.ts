export function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const limit = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < limit; index += 1) {
    const leftCode = leftPoints[index]?.codePointAt(0) ?? 0;
    const rightCode = rightPoints[index]?.codePointAt(0) ?? 0;
    if (leftCode !== rightCode) {
      return leftCode < rightCode ? -1 : 1;
    }
  }
  return leftPoints.length - rightPoints.length;
}

/** Device-default collation used by checkout hashes before code-point sort. */
export function compareLocaleText(left: string, right: string): number {
  const collation = left.localeCompare(right);
  if (collation !== 0) {
    return collation;
  }
  return compareCodePoints(left, right);
}

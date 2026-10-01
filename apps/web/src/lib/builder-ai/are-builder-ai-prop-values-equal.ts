import {
  MAX_AI_PLAN_OPERATIONS,
  MAX_BUILDER_ARRAY_ITEMS,
  MAX_BUILDER_DATA_DEPTH,
} from '@baci/shared/contracts';

const maxComparisonNodes = MAX_AI_PLAN_OPERATIONS * MAX_BUILDER_ARRAY_ITEMS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPairState(
  left: object,
  right: object,
  leftToRight: Map<object, object>,
  rightToLeft: Map<object, object>
): 'mismatch' | 'new' | 'seen' {
  const mappedRight = leftToRight.get(left);
  const mappedLeft = rightToLeft.get(right);
  if (mappedRight || mappedLeft) {
    return mappedRight === right && mappedLeft === left ? 'seen' : 'mismatch';
  }
  leftToRight.set(left, right);
  rightToLeft.set(right, left);
  return 'new';
}

export function areBuilderAiPropValuesEqual(
  left: unknown,
  right: unknown
): boolean {
  const stack = [{ depth: 0, left, right }];
  const leftToRight = new Map<object, object>();
  const rightToLeft = new Map<object, object>();
  let nodes = 0;

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry || ++nodes > maxComparisonNodes) return false;
    if (entry.depth > MAX_BUILDER_DATA_DEPTH) return false;
    if (Object.is(entry.left, entry.right)) continue;
    if (
      typeof entry.left === 'number' &&
      typeof entry.right === 'number' &&
      entry.left === entry.right
    ) {
      continue;
    }
    if (Array.isArray(entry.left) && Array.isArray(entry.right)) {
      if (
        entry.left.length !== entry.right.length ||
        entry.left.length > MAX_BUILDER_ARRAY_ITEMS
      ) {
        return false;
      }
      const pairState = getPairState(
        entry.left,
        entry.right,
        leftToRight,
        rightToLeft
      );
      if (pairState === 'mismatch') return false;
      if (pairState === 'seen') continue;
      for (let index = 0; index < entry.left.length; index += 1) {
        stack.push({
          depth: entry.depth + 1,
          left: entry.left[index],
          right: entry.right[index],
        });
      }
      continue;
    }
    if (!isRecord(entry.left) || !isRecord(entry.right)) return false;
    const leftKeys = Object.keys(entry.left);
    if (
      leftKeys.length !== Object.keys(entry.right).length ||
      leftKeys.length > MAX_BUILDER_ARRAY_ITEMS
    ) {
      return false;
    }
    const pairState = getPairState(
      entry.left,
      entry.right,
      leftToRight,
      rightToLeft
    );
    if (pairState === 'mismatch') return false;
    if (pairState === 'seen') continue;
    for (const key of leftKeys) {
      if (!Object.hasOwn(entry.right, key)) return false;
      stack.push({
        depth: entry.depth + 1,
        left: entry.left[key],
        right: entry.right[key],
      });
    }
  }
  return true;
}

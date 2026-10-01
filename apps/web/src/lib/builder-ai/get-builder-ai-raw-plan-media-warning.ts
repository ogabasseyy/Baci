import {
  MAX_AI_PLAN_OPERATIONS,
  MAX_BUILDER_ARRAY_ITEMS,
  MAX_BUILDER_DATA_DEPTH,
} from '@baci/shared/contracts';
import { isBuilderAiMediaField } from './builder-ai-media-fields';

const mediaWarning = 'Media changes require Baci manual asset controls.';
const maxRawPlanNodes = MAX_AI_PLAN_OPERATIONS * MAX_BUILDER_ARRAY_ITEMS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function containsMediaField(operations: unknown[]): boolean | undefined {
  if (operations.length > MAX_AI_PLAN_OPERATIONS) return undefined;
  const stack = operations.map((value) => ({ depth: 2, value }));
  const seen = new Set<object>();
  let nodes = 0;
  let mediaFound = false;

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry || ++nodes > maxRawPlanNodes) return undefined;
    if (entry.depth > MAX_BUILDER_DATA_DEPTH) return undefined;
    if (typeof entry.value !== 'object' || entry.value === null) continue;
    if (seen.has(entry.value)) continue;
    seen.add(entry.value);
    if (Array.isArray(entry.value)) {
      if (
        entry.value.length > MAX_BUILDER_ARRAY_ITEMS ||
        stack.length + entry.value.length > maxRawPlanNodes
      ) {
        return undefined;
      }
      for (const value of entry.value) {
        stack.push({ depth: entry.depth + 1, value });
      }
      continue;
    }
    if (!isRecord(entry.value)) continue;
    for (const property in entry.value) {
      if (!Object.hasOwn(entry.value, property)) continue;
      if (stack.length >= maxRawPlanNodes) return undefined;
      if (isBuilderAiMediaField(property)) mediaFound = true;
      stack.push({ depth: entry.depth + 1, value: entry.value[property] });
    }
  }
  return mediaFound;
}

export function getBuilderAiRawPlanMediaWarning(
  plan: unknown
): string | undefined {
  if (!isRecord(plan) || !Array.isArray(plan.operations)) return undefined;
  return containsMediaField(plan.operations) ? mediaWarning : undefined;
}

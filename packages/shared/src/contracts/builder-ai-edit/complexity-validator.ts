import { z } from 'zod';
import {
  MAX_AI_EDIT_BODY_BYTES,
  MAX_AI_PLAN_INSERTS,
  MAX_BUILDER_ARRAY_ITEMS,
  MAX_BUILDER_BLOCKS,
  MAX_BUILDER_DATA_DEPTH,
  MAX_BUILDER_STRING_BYTES,
  MAX_BUILDER_ZONE_KEYS,
} from './limits';

type ComplexityFailure = { success: false; error: z.ZodError };
type ComplexitySuccess = { success: true };
type ComplexityResult = ComplexityFailure | ComplexitySuccess;

function failure(message: string): ComplexityFailure {
  return {
    error: new z.ZodError([{ code: 'custom', message, path: [] }]),
    success: false,
  };
}

function isBuilderComponentArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof (item as { type?: unknown }).type === 'string'
    )
  );
}

function inspect(
  value: unknown,
  depth = 0,
  enforceArrayLimit = true,
  zoneCollection = false
): ComplexityResult {
  if (depth > MAX_BUILDER_DATA_DEPTH)
    return failure('Document nesting is too deep');
  if (typeof value === 'string') {
    return new TextEncoder().encode(value).byteLength > MAX_BUILDER_STRING_BYTES
      ? failure('Document string is too long')
      : { success: true };
  }
  if (Array.isArray(value)) {
    if (enforceArrayLimit && value.length > MAX_BUILDER_ARRAY_ITEMS)
      return failure('Array is too large');
    for (const item of value) {
      const result = inspect(item, depth + 1);
      if (!result.success) return result;
    }
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const result = inspect(
        child,
        depth + 1,
        !(depth === 0 && key === 'content') &&
          !(zoneCollection && isBuilderComponentArray(child)),
        depth === 0 && key === 'zones'
      );
      if (!result.success) return result;
    }
  }
  return { success: true };
}

export function validateBuilderAiEditComplexity(
  value: unknown
): ComplexityResult {
  try {
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      MAX_AI_EDIT_BODY_BYTES
    ) {
      return failure('Document is too large');
    }
  } catch {
    return failure('Document is not serializable');
  }
  if (Array.isArray(value) && value.length > MAX_BUILDER_BLOCKS) {
    return failure('Document has too many blocks');
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const document = value as Record<string, unknown>;
    if (
      Array.isArray(document.content) &&
      document.content.length > MAX_BUILDER_BLOCKS
    ) {
      return failure('Document has too many blocks');
    }
    if (
      document.zones &&
      typeof document.zones === 'object' &&
      !Array.isArray(document.zones) &&
      Object.keys(document.zones).length > MAX_BUILDER_ZONE_KEYS
    ) {
      return failure('Document has too many zones');
    }
    const zoneBlocks =
      document.zones &&
      typeof document.zones === 'object' &&
      !Array.isArray(document.zones)
        ? Object.values(document.zones).reduce(
            (total, zone) => total + (Array.isArray(zone) ? zone.length : 0),
            0
          )
        : 0;
    const contentBlocks = Array.isArray(document.content)
      ? document.content.length
      : 0;
    if (contentBlocks + zoneBlocks > MAX_BUILDER_BLOCKS) {
      return failure('Document has too many blocks');
    }
  }
  return inspect(value);
}

export function validateBuilderAiEditPlanLimits(
  value: unknown
): ComplexityResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { success: true };
  }
  const operations = (value as { operations?: unknown }).operations;
  if (!Array.isArray(operations)) return { success: true };
  const inserts = operations.filter(
    (operation) =>
      operation &&
      typeof operation === 'object' &&
      (operation as { kind?: unknown }).kind === 'insert_component'
  ).length;
  return inserts > MAX_AI_PLAN_INSERTS
    ? failure('Plan has too many inserts')
    : { success: true };
}

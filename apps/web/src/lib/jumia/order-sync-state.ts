export const FULL_FAILURE_SYNC_CONFIG_KEY = 'jumia_full_failure';

function cloneSyncConfig(syncConfig: unknown): Record<string, unknown> {
  if (
    !syncConfig ||
    typeof syncConfig !== 'object' ||
    Array.isArray(syncConfig)
  ) {
    return {};
  }
  return { ...syncConfig };
}

export function clearFullFailureState(
  syncConfig: unknown
): Record<string, unknown> {
  const nextConfig = cloneSyncConfig(syncConfig);
  delete nextConfig[FULL_FAILURE_SYNC_CONFIG_KEY];
  return nextConfig;
}

export function readFullFailureState(
  syncConfig: unknown
): { cursor: string; count: number } | null {
  if (
    !syncConfig ||
    typeof syncConfig !== 'object' ||
    Array.isArray(syncConfig)
  ) {
    return null;
  }
  const state = (syncConfig as Record<string, unknown>)[
    FULL_FAILURE_SYNC_CONFIG_KEY
  ];
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  const payload = state as Record<string, unknown>;
  const cursor = payload.cursor;
  const count = payload.count;
  if (typeof cursor !== 'string' || !cursor.trim()) {
    return null;
  }
  if (typeof count !== 'number') return null;
  if (!Number.isSafeInteger(count) || count < 0) {
    return null;
  }
  return { cursor, count };
}

export function withFullFailureState(
  syncConfig: unknown,
  cursor: string,
  count: number,
  updatedAt = new Date().toISOString()
): Record<string, unknown> {
  if (!cursor?.trim()) {
    throw new TypeError('cursor must be a non-empty, non-whitespace string');
  }
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError('count must be a non-negative safe integer');
  }

  return {
    ...cloneSyncConfig(syncConfig),
    [FULL_FAILURE_SYNC_CONFIG_KEY]: {
      cursor,
      count,
      updated_at: updatedAt,
    },
  };
}

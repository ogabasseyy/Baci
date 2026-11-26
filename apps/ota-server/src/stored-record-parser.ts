import type {
  ChannelCurrentState,
  OtaWorkerEnv,
  R2ObjectBodyLike,
  StoredManifestAsset,
  StoredReleaseRecord,
} from './types';
import {
  errorResponse,
  isPlainObject,
  ValidationError,
  validateAssetKey,
  validateUpdateId,
} from './validation';

const SHA256_BASE64URL_REGEX = /^[A-Za-z0-9_-]{43}$/;

function isValidIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    !Number.isNaN(Date.parse(value))
  );
}

function isValidUuidString(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    validateUpdateId(value);
    return true;
  } catch {
    return false;
  }
}

function isValidRollbackHistoryEntry(raw: unknown): boolean {
  if (!isPlainObject(raw)) {
    return false;
  }
  if (typeof raw.key !== 'string' || raw.key.length === 0) {
    return false;
  }
  if (raw.fingerprint !== undefined && typeof raw.fingerprint !== 'string') {
    return false;
  }
  return isPlainObject(raw.response);
}

function parseStoredAsset(raw: unknown): StoredManifestAsset | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  const { hash, key, contentType, fileExtension, r2Key } = raw;
  if (
    typeof hash !== 'string' ||
    !SHA256_BASE64URL_REGEX.test(hash) ||
    typeof key !== 'string' ||
    key.trim().length === 0 ||
    typeof contentType !== 'string' ||
    contentType.trim().length === 0 ||
    typeof r2Key !== 'string' ||
    r2Key.length === 0
  ) {
    return null;
  }
  if (
    fileExtension !== undefined &&
    (typeof fileExtension !== 'string' ||
      !/^\.[a-zA-Z0-9]+$/.test(fileExtension))
  ) {
    return null;
  }
  try {
    validateAssetKey(r2Key);
  } catch (err) {
    if (err instanceof ValidationError) {
      return null;
    }
    throw err;
  }
  return raw as unknown as StoredManifestAsset;
}

export function parseStoredPointer(raw: unknown): ChannelCurrentState | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  if (raw.updatedAt !== undefined && !isValidIsoTimestamp(raw.updatedAt)) {
    return null;
  }
  if (
    raw.previousUpdateId !== undefined &&
    !isValidUuidString(raw.previousUpdateId)
  ) {
    return null;
  }
  if (
    raw.previousMode !== undefined &&
    raw.previousMode !== 'update' &&
    raw.previousMode !== 'rollback_to_embedded'
  ) {
    return null;
  }
  if (
    raw.activeSourceUpdateId !== undefined &&
    !isValidUuidString(raw.activeSourceUpdateId)
  ) {
    return null;
  }
  if (
    raw.lastRollback !== undefined &&
    !isValidRollbackHistoryEntry(raw.lastRollback)
  ) {
    return null;
  }
  if (raw.recentRollbacks !== undefined) {
    if (
      !Array.isArray(raw.recentRollbacks) ||
      !raw.recentRollbacks.every(isValidRollbackHistoryEntry)
    ) {
      return null;
    }
  }
  if (raw.mode === 'update' && isValidUuidString(raw.updateId)) {
    return raw as ChannelCurrentState;
  }
  if (
    raw.mode === 'rollback_to_embedded' &&
    isValidIsoTimestamp(raw.commitTime)
  ) {
    return raw as ChannelCurrentState;
  }
  return null;
}

export function parseStoredRelease(raw: unknown): StoredReleaseRecord | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  if (
    !isValidUuidString(raw.id) ||
    !isValidIsoTimestamp(raw.createdAt) ||
    typeof raw.runtimeVersion !== 'string' ||
    raw.runtimeVersion.trim().length === 0 ||
    typeof raw.channel !== 'string' ||
    raw.channel.trim().length === 0 ||
    (raw.platform !== 'ios' && raw.platform !== 'android') ||
    !parseStoredAsset(raw.launchAsset) ||
    !Array.isArray(raw.assets) ||
    !isPlainObject(raw.metadata) ||
    !isPlainObject(raw.extra)
  ) {
    return null;
  }
  for (const asset of raw.assets) {
    if (!parseStoredAsset(asset)) {
      return null;
    }
  }
  for (const value of Object.values(raw.metadata)) {
    if (typeof value !== 'string') {
      return null;
    }
  }
  return raw as unknown as StoredReleaseRecord;
}

export async function readStoredPointerOrError(
  env: OtaWorkerEnv,
  pointerKey: string
): Promise<
  { obj: R2ObjectBodyLike | null; state: ChannelCurrentState | null } | Response
> {
  const obj = await env.OTA_BUCKET.get(pointerKey);
  if (!obj) {
    return { obj: null, state: null };
  }
  try {
    const parsed = parseStoredPointer(await obj.json<unknown>());
    if (!parsed) {
      return errorResponse('Corrupt release pointer in storage', 500);
    }
    return { obj, state: parsed };
  } catch {
    return errorResponse('Corrupt release pointer in storage', 500);
  }
}

export async function readStoredReleaseOrError(
  env: OtaWorkerEnv,
  releaseKey: string,
  notFoundMessage: string
): Promise<StoredReleaseRecord | Response> {
  const obj = await env.OTA_BUCKET.get(releaseKey);
  if (!obj) {
    return errorResponse(notFoundMessage, 404);
  }
  try {
    const parsed = parseStoredRelease(await obj.json<unknown>());
    if (!parsed) {
      return errorResponse('Corrupt release manifest in storage', 500);
    }
    return parsed;
  } catch {
    return errorResponse('Corrupt release manifest in storage', 500);
  }
}

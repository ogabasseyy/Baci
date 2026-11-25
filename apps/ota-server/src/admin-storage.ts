import { sha256Base64Url } from './crypto';
import type {
  ChannelCurrentState,
  OtaWorkerEnv,
  RollbackHistoryEntry,
  RollbackOperationResult,
  StoredManifestAsset,
  StoredReleaseRecord,
} from './types';
import { errorResponse, isPlainObject, ValidationError } from './validation';

const MAX_POINTER_RETRIES = 5;
const MAX_ROLLBACK_HISTORY = 20;
const MAX_SAFE_TIMESTAMP_MS = 253_402_300_799_000;

export type RecordedRollbackLookup =
  | { status: 'match'; response: RollbackOperationResult }
  | { status: 'mismatch' };

export function findRecordedRollback(
  state: ChannelCurrentState | null | undefined,
  key: string,
  expectedFingerprint: string
): RecordedRollbackLookup | undefined {
  if (!state) return undefined;
  const entry =
    state.lastRollback?.key === key
      ? state.lastRollback
      : state.recentRollbacks?.find((item) => item.key === key);
  if (!entry) return undefined;
  if (
    entry.fingerprint !== undefined &&
    entry.fingerprint !== expectedFingerprint
  ) {
    return { status: 'mismatch' };
  }
  return { status: 'match', response: entry.response };
}

export function mergeRollbackHistory(
  existing: ChannelCurrentState | null | undefined,
  nextEntry?: RollbackHistoryEntry
): RollbackHistoryEntry[] | undefined {
  const existingEntries = existing?.recentRollbacks
    ? [...existing.recentRollbacks]
    : existing?.lastRollback
      ? [existing.lastRollback]
      : [];
  if (nextEntry) {
    const filtered = existingEntries.filter(
      (entry) => entry.key !== nextEntry.key
    );
    filtered.push(nextEntry);
    return filtered.slice(-MAX_ROLLBACK_HISTORY);
  }
  return existingEntries.length > 0
    ? existingEntries.slice(-MAX_ROLLBACK_HISTORY)
    : undefined;
}

export function nextMonotonicTimestamp(
  ...priorIsoTimestamps: (string | undefined)[]
): string {
  let maxMs = Date.now();
  for (const ts of priorIsoTimestamps) {
    if (!ts) continue;
    const parsed = Date.parse(ts);
    if (!Number.isNaN(parsed) && parsed >= maxMs) {
      if (parsed >= MAX_SAFE_TIMESTAMP_MS) {
        throw new ValidationError(
          'Stored channel timestamp exceeds safe operational range',
          422
        );
      }
      maxMs = parsed + 1;
    }
  }
  if (maxMs > MAX_SAFE_TIMESTAMP_MS) {
    throw new ValidationError('Timestamp exceeds safe operational range', 422);
  }
  return new Date(maxMs).toISOString();
}

export type PointerCasAction =
  | { kind: 'write'; state: ChannelCurrentState }
  | { kind: 'noop'; state: ChannelCurrentState }
  | { kind: 'idempotent'; result: RollbackOperationResult }
  | { kind: 'error'; response: Response };

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export function canonicalDeepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, idx) => canonicalDeepEqual(item, b[idx]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a).filter((key) => a[key] !== undefined);
    const keysB = Object.keys(b).filter((key) => b[key] !== undefined);
    if (keysA.length !== keysB.length) {
      return false;
    }
    return keysA.every(
      (key) => Object.hasOwn(b, key) && canonicalDeepEqual(a[key], b[key])
    );
  }
  return false;
}

export async function verifyAssetIntegrity(
  env: OtaWorkerEnv,
  asset: StoredManifestAsset
): Promise<string | null> {
  if (!asset.r2Key) {
    return null;
  }
  const storageKey = `assets/${asset.r2Key}`;
  const head = await env.OTA_BUCKET.head(storageKey);
  if (!head) {
    return `Referenced asset does not exist in R2: ${asset.r2Key}`;
  }

  const metadataHash = head.customMetadata?.sha256Base64Url;
  if (metadataHash !== undefined) {
    return metadataHash === asset.hash
      ? null
      : `Stored asset hash mismatch in R2: ${asset.r2Key}`;
  }

  const obj = await env.OTA_BUCKET.get(storageKey);
  if (!obj) {
    return `Referenced asset does not exist in R2: ${asset.r2Key}`;
  }
  const bytes = new Uint8Array(await new Response(obj.body).arrayBuffer());
  const computedHash = sha256Base64Url(bytes);
  return computedHash === asset.hash
    ? null
    : `Stored asset hash mismatch in R2: ${asset.r2Key}`;
}

export async function putImmutableAsset(
  env: OtaWorkerEnv,
  storageKey: string,
  bytes: Uint8Array,
  contentType: string,
  sha256HexValue: string,
  sha256Base64UrlValue: string
): Promise<'created' | 'matched' | 'conflict'> {
  const created = await env.OTA_BUCKET.put(storageKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      sha256Hex: sha256HexValue,
      sha256Base64Url: sha256Base64UrlValue,
    },
    onlyIf: { etagDoesNotMatch: '*' },
  });
  if (created) {
    return 'created';
  }

  const existing = await env.OTA_BUCKET.get(storageKey);
  if (!existing) {
    return 'conflict';
  }
  const existingType =
    existing.httpMetadata?.contentType?.trim() || 'application/octet-stream';
  if (existingType !== contentType) {
    return 'conflict';
  }
  const existingBytes = new Uint8Array(
    await new Response(existing.body).arrayBuffer()
  );
  return bytesEqual(existingBytes, bytes) ? 'matched' : 'conflict';
}

export type ImmutableReleaseResult =
  | { status: 'created'; createdAt: string }
  | { status: 'matched'; createdAt: string }
  | { status: 'conflict' };

export async function putImmutableRelease(
  env: OtaWorkerEnv,
  releaseKey: string,
  releaseRecord: StoredReleaseRecord,
  options?: { ignoreCreatedAtOnMatch?: boolean }
): Promise<ImmutableReleaseResult> {
  const serialized = JSON.stringify(releaseRecord);
  const created = await env.OTA_BUCKET.put(releaseKey, serialized, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    onlyIf: { etagDoesNotMatch: '*' },
  });
  if (created) {
    return { status: 'created', createdAt: releaseRecord.createdAt };
  }

  const existing = await env.OTA_BUCKET.get(releaseKey);
  if (!existing) {
    return { status: 'conflict' };
  }
  try {
    const existingRecord = await existing.json<StoredReleaseRecord>();
    const serializedCandidate = JSON.parse(serialized) as StoredReleaseRecord;
    const candidate = options?.ignoreCreatedAtOnMatch
      ? { ...serializedCandidate, createdAt: existingRecord.createdAt }
      : serializedCandidate;
    return canonicalDeepEqual(existingRecord, candidate)
      ? { status: 'matched', createdAt: existingRecord.createdAt }
      : { status: 'conflict' };
  } catch {
    return { status: 'conflict' };
  }
}

export async function updateChannelPointerCas(
  env: OtaWorkerEnv,
  pointerKey: string,
  decideNext: (
    existing: ChannelCurrentState | null
  ) => Promise<PointerCasAction> | PointerCasAction
): Promise<
  | { state: ChannelCurrentState }
  | { idempotentResult: RollbackOperationResult }
  | Response
> {
  for (let attempt = 0; attempt < MAX_POINTER_RETRIES; attempt += 1) {
    const existingObj = await env.OTA_BUCKET.get(pointerKey);
    const existingState = existingObj
      ? await existingObj.json<ChannelCurrentState>()
      : null;
    const action = await decideNext(existingState);
    if (action.kind === 'error') {
      return action.response;
    }
    if (action.kind === 'noop') {
      return { state: action.state };
    }
    if (action.kind === 'idempotent') {
      return { idempotentResult: action.result };
    }

    const etagMatchValue =
      existingObj?.etag ??
      (existingObj?.httpEtag
        ? existingObj.httpEtag.replace(/^"(.*)"$/, '$1')
        : undefined);
    const written = await env.OTA_BUCKET.put(
      pointerKey,
      JSON.stringify(action.state),
      {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
        onlyIf: etagMatchValue
          ? { etagMatches: etagMatchValue }
          : { etagDoesNotMatch: '*' },
      }
    );
    if (written) {
      return { state: action.state };
    }
  }
  return errorResponse(
    'Concurrent channel pointer update conflict; retry',
    409
  );
}

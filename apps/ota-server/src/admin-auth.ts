import { timingSafeBearerMatch } from './crypto';
import type { OtaWorkerEnv, PublishPayload, RollbackPayload } from './types';
import {
  errorResponse,
  isPlainObject,
  MAX_EXTRA_BYTES,
  MAX_MANIFEST_ASSETS,
  MAX_METADATA_BYTES,
  MAX_PUBLISH_JSON_BYTES,
  readBodyBytesWithLimit,
  ValidationError,
  validateChannelName,
  validateCommitSha,
  validatePlatform,
  validateRuntimeVersion,
  validateStoredAsset,
  validateUpdateId,
} from './validation';

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: false,
});
const MAX_SAFE_TIMESTAMP_MS = 253_402_300_799_000;

export function authenticateAdmin(
  request: Request,
  env: OtaWorkerEnv
): Response | null {
  if (!env.OTA_ADMIN_TOKEN || env.OTA_ADMIN_TOKEN.trim().length === 0) {
    return errorResponse('OTA admin token is not configured', 503);
  }
  if (
    !timingSafeBearerMatch(
      request.headers.get('authorization'),
      env.OTA_ADMIN_TOKEN
    )
  ) {
    return errorResponse('Unauthorized', 401);
  }
  return null;
}

export async function parseJsonBody(
  request: Request,
  maxBytes = MAX_PUBLISH_JSON_BYTES
): Promise<unknown> {
  const bytes = await readBodyBytesWithLimit(request, maxBytes);
  try {
    return JSON.parse(UTF8_DECODER.decode(bytes)) as unknown;
  } catch {
    throw new ValidationError('Malformed JSON request body', 400);
  }
}

const IDEMPOTENCY_KEY_REGEX = /^[a-zA-Z0-9._:-]{8,128}$/;

function parseOptionalChannel(raw: unknown): string {
  if (raw === undefined) {
    return 'production';
  }
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new ValidationError('Invalid channel name');
  }
  return validateChannelName(raw);
}

function validateMetadataRecord(raw: unknown): Record<string, string> {
  if (raw === undefined) {
    return {};
  }
  if (!isPlainObject(raw)) {
    throw new ValidationError('metadata must be an object');
  }
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string') {
      throw new ValidationError(`metadata.${key} must be a string`);
    }
    entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

export function parseIdempotencyKey(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'string' || !IDEMPOTENCY_KEY_REGEX.test(raw.trim())) {
    throw new ValidationError(
      'Invalid idempotencyKey (expected 8-128 chars of [a-zA-Z0-9._:-])'
    );
  }
  return raw.trim();
}

export function parsePublishPayload(body: unknown): PublishPayload {
  if (!isPlainObject(body)) {
    throw new ValidationError('Publish payload must be a JSON object');
  }

  const platform = validatePlatform(
    typeof body.platform === 'string' ? body.platform : null
  );
  const runtimeVersion = validateRuntimeVersion(
    typeof body.runtimeVersion === 'string' ? body.runtimeVersion : null
  );
  const channel = parseOptionalChannel(body.channel);
  const updateId =
    body.updateId !== undefined
      ? validateUpdateId(typeof body.updateId === 'string' ? body.updateId : '')
      : crypto.randomUUID().toLowerCase();

  let createdAt: string | undefined;
  if (body.createdAt !== undefined) {
    if (typeof body.createdAt !== 'string') {
      throw new ValidationError('createdAt must be a valid ISO-8601 timestamp');
    }
    const parsedMs = Date.parse(body.createdAt);
    if (
      Number.isNaN(parsedMs) ||
      parsedMs < 0 ||
      parsedMs > MAX_SAFE_TIMESTAMP_MS
    ) {
      throw new ValidationError(
        'createdAt must be a valid ISO-8601 timestamp in safe operational range'
      );
    }
    createdAt = new Date(parsedMs).toISOString();
  }

  const sourceSha =
    body.sourceSha !== undefined
      ? validateCommitSha(
          typeof body.sourceSha === 'string' ? body.sourceSha : ''
        )
      : undefined;

  const launchAsset = validateStoredAsset(body.launchAsset, 'launchAsset');

  let assets: PublishPayload['assets'] = [];
  if (body.assets !== undefined) {
    if (!Array.isArray(body.assets)) {
      throw new ValidationError('assets must be an array');
    }
    if (body.assets.length > MAX_MANIFEST_ASSETS) {
      throw new ValidationError(
        `assets exceeds maximum of ${MAX_MANIFEST_ASSETS} entries`,
        413
      );
    }
    assets = body.assets.map((item, idx) =>
      validateStoredAsset(item, `assets[${idx}]`)
    );
  }

  const metadata = validateMetadataRecord(body.metadata);
  if (
    UTF8_ENCODER.encode(JSON.stringify(metadata)).byteLength >
    MAX_METADATA_BYTES
  ) {
    throw new ValidationError(
      `metadata exceeds maximum of ${MAX_METADATA_BYTES} bytes`,
      413
    );
  }

  const extra =
    body.extra === undefined
      ? {}
      : isPlainObject(body.extra)
        ? body.extra
        : (() => {
            throw new ValidationError('extra must be an object');
          })();
  if (UTF8_ENCODER.encode(JSON.stringify(extra)).byteLength > MAX_EXTRA_BYTES) {
    throw new ValidationError(
      `extra exceeds maximum of ${MAX_EXTRA_BYTES} bytes`,
      413
    );
  }

  return {
    channel,
    platform,
    runtimeVersion,
    updateId,
    ...(createdAt ? { createdAt } : {}),
    ...(sourceSha ? { sourceSha } : {}),
    launchAsset,
    assets,
    metadata,
    extra,
  };
}

export function parseRollbackPayload(body: unknown): RollbackPayload {
  if (!isPlainObject(body)) {
    throw new ValidationError('Rollback payload must be a JSON object');
  }
  const platform = validatePlatform(
    typeof body.platform === 'string' ? body.platform : null
  );
  const runtimeVersion = validateRuntimeVersion(
    typeof body.runtimeVersion === 'string' ? body.runtimeVersion : null
  );
  const channel = parseOptionalChannel(body.channel);
  const targetUpdateId =
    body.targetUpdateId !== undefined
      ? validateUpdateId(
          typeof body.targetUpdateId === 'string' ? body.targetUpdateId : ''
        )
      : undefined;
  const toEmbedded = body.toEmbedded === true;
  const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);

  if (body.toEmbedded !== undefined && typeof body.toEmbedded !== 'boolean') {
    throw new ValidationError('toEmbedded must be a boolean');
  }
  if (toEmbedded && targetUpdateId) {
    throw new ValidationError(
      'Specify either targetUpdateId or toEmbedded, not both'
    );
  }

  return {
    channel,
    platform,
    runtimeVersion,
    ...(targetUpdateId ? { targetUpdateId } : {}),
    toEmbedded,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

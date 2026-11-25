import { timingSafeBearerMatch } from './crypto';
import type { OtaWorkerEnv, PublishPayload, RollbackPayload } from './types';
import {
  errorResponse,
  isPlainObject,
  ValidationError,
  validateChannelName,
  validateCommitSha,
  validatePlatform,
  validateRuntimeVersion,
  validateStoredAsset,
  validateUpdateId,
} from './validation';

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

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError('Malformed JSON request body', 400);
  }
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
  const channel = validateChannelName(
    typeof body.channel === 'string' ? body.channel : null
  );
  const updateId =
    body.updateId !== undefined
      ? validateUpdateId(typeof body.updateId === 'string' ? body.updateId : '')
      : crypto.randomUUID().toLowerCase();

  let createdAt = new Date().toISOString();
  if (body.createdAt !== undefined) {
    if (
      typeof body.createdAt !== 'string' ||
      Number.isNaN(Date.parse(body.createdAt))
    ) {
      throw new ValidationError('createdAt must be a valid ISO-8601 timestamp');
    }
    createdAt = new Date(body.createdAt).toISOString();
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
    assets = body.assets.map((item, idx) =>
      validateStoredAsset(item, `assets[${idx}]`)
    );
  }

  const metadata =
    body.metadata === undefined
      ? {}
      : isPlainObject(body.metadata)
        ? body.metadata
        : (() => {
            throw new ValidationError('metadata must be an object');
          })();

  const extra =
    body.extra === undefined
      ? {}
      : isPlainObject(body.extra)
        ? body.extra
        : (() => {
            throw new ValidationError('extra must be an object');
          })();

  return {
    channel,
    platform,
    runtimeVersion,
    updateId,
    createdAt,
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
  const channel = validateChannelName(
    typeof body.channel === 'string' ? body.channel : null
  );
  const targetUpdateId =
    body.targetUpdateId !== undefined
      ? validateUpdateId(
          typeof body.targetUpdateId === 'string' ? body.targetUpdateId : ''
        )
      : undefined;
  const toEmbedded = body.toEmbedded === true;

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
  };
}

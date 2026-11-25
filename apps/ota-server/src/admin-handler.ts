import {
  authenticateAdmin,
  parseJsonBody,
  parsePublishPayload,
} from './admin-auth';
import {
  mergeRollbackHistory,
  nextMonotonicTimestamp,
  putImmutableAsset,
  putImmutableRelease,
  updateChannelPointerCas,
  verifyAssetIntegrity,
} from './admin-storage';
import { sha256Base64Url, sha256Hex } from './crypto';
import type {
  ChannelCurrentState,
  OtaWorkerEnv,
  PublishPayload,
  StoredReleaseRecord,
} from './types';
import {
  errorResponse,
  jsonResponse,
  MAX_ASSET_UPLOAD_BYTES,
  MAX_PUBLISH_JSON_BYTES,
  readBodyBytesWithLimit,
  ValidationError,
  validateAssetKey,
} from './validation';

const ADMIN_ASSETS_PREFIX = '/api/admin/assets/';
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/i;
const MAX_FUTURE_PUBLISH_SKEW_MS = 5 * 60 * 1000;

export async function handleAdminUploadAsset(
  request: Request,
  env: OtaWorkerEnv,
  pathname: string
): Promise<Response> {
  if (request.method !== 'PUT') {
    return errorResponse('Method not allowed', 405);
  }
  const authError = authenticateAdmin(request, env);
  if (authError) {
    return authError;
  }

  let assetKey: string;
  try {
    assetKey = validateAssetKey(pathname.slice(ADMIN_ASSETS_PREFIX.length));
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(err.message, err.status);
    }
    throw err;
  }

  const expectedSha256 = request.headers.get('x-asset-sha256')?.trim();
  if (!expectedSha256 || !SHA256_HEX_REGEX.test(expectedSha256)) {
    return errorResponse(
      'Missing or invalid x-asset-sha256 header (expected 64-char hex)',
      400
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBodyBytesWithLimit(request, MAX_ASSET_UPLOAD_BYTES);
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(err.message, err.status);
    }
    throw err;
  }
  if (bytes.byteLength === 0) {
    return errorResponse('Asset body cannot be empty', 400);
  }

  const actualSha256 = sha256Hex(bytes);
  if (expectedSha256.toLowerCase() !== actualSha256.toLowerCase()) {
    return errorResponse('Uploaded asset SHA-256 mismatch', 400);
  }
  const actualBase64Url = sha256Base64Url(bytes);

  const contentType =
    request.headers.get('content-type')?.trim() || 'application/octet-stream';
  const storageKey = `assets/${assetKey}`;
  const status = await putImmutableAsset(
    env,
    storageKey,
    bytes,
    contentType,
    actualSha256,
    actualBase64Url
  );
  if (status === 'conflict') {
    return errorResponse(
      'Asset already exists with conflicting bytes or content type',
      409
    );
  }

  return jsonResponse({
    ok: true,
    r2Key: assetKey,
    storageKey,
    size: bytes.byteLength,
    sha256: actualSha256,
  });
}

export async function handleAdminPublish(
  request: Request,
  env: OtaWorkerEnv
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }
  const authError = authenticateAdmin(request, env);
  if (authError) {
    return authError;
  }

  let payload: PublishPayload;
  try {
    payload = parsePublishPayload(
      await parseJsonBody(request, MAX_PUBLISH_JSON_BYTES)
    );
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(err.message, err.status);
    }
    throw err;
  }

  const channel = payload.channel ?? 'production';
  const updateId = payload.updateId ?? crypto.randomUUID().toLowerCase();
  const callerProvidedCreatedAt = payload.createdAt !== undefined;
  const pointerKey = `channels/${channel}/${payload.platform}/${payload.runtimeVersion}/current.json`;

  if (payload.createdAt !== undefined) {
    if (
      Date.parse(payload.createdAt) >
      Date.now() + MAX_FUTURE_PUBLISH_SKEW_MS
    ) {
      return errorResponse(
        'Publish createdAt cannot be more than 5 minutes in the future',
        400
      );
    }
  }

  const initialPointerObj = await env.OTA_BUCKET.get(pointerKey);
  const initialPointer = initialPointerObj
    ? await initialPointerObj.json<ChannelCurrentState>()
    : null;

  if (
    payload.createdAt !== undefined &&
    initialPointer?.updatedAt &&
    !(
      initialPointer.mode === 'update' && initialPointer.updateId === updateId
    ) &&
    Date.parse(payload.createdAt) <= Date.parse(initialPointer.updatedAt)
  ) {
    return errorResponse(
      'Publish createdAt must be strictly newer than the active release timestamp; retry with a new updateId',
      409,
      'STALE_TIMESTAMP_CONFLICT'
    );
  }

  let createdAt: string;
  try {
    createdAt =
      payload.createdAt ?? nextMonotonicTimestamp(initialPointer?.updatedAt);
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(err.message, err.status);
    }
    throw err;
  }
  const assets = payload.assets ?? [];

  for (const asset of [payload.launchAsset, ...assets]) {
    const integrityError = await verifyAssetIntegrity(env, asset);
    if (integrityError) {
      return errorResponse(integrityError, 400);
    }
  }

  const releaseRecord: StoredReleaseRecord = {
    id: updateId,
    createdAt,
    runtimeVersion: payload.runtimeVersion,
    channel,
    platform: payload.platform,
    ...(payload.sourceSha ? { sourceSha: payload.sourceSha } : {}),
    launchAsset: payload.launchAsset,
    assets,
    metadata: payload.metadata ?? {},
    extra: payload.extra ?? {},
  };

  const releaseKey = `releases/${channel}/${payload.platform}/${payload.runtimeVersion}/${updateId}.json`;
  const releaseResult = await putImmutableRelease(
    env,
    releaseKey,
    releaseRecord,
    { ignoreCreatedAtOnMatch: !callerProvidedCreatedAt }
  );
  if (releaseResult.status === 'conflict') {
    return errorResponse(
      `Release already exists with conflicting content for updateId: ${updateId}`,
      409
    );
  }
  const effectiveCreatedAt = releaseResult.createdAt;

  const result = await updateChannelPointerCas(env, pointerKey, (existing) => {
    if (
      existing?.updatedAt &&
      !(existing.mode === 'update' && existing.updateId === updateId) &&
      Date.parse(effectiveCreatedAt) <= Date.parse(existing.updatedAt)
    ) {
      return {
        kind: 'error',
        response: errorResponse(
          'Concurrent publish recorded a newer release timestamp; retry with a new updateId',
          409,
          'STALE_TIMESTAMP_CONFLICT'
        ),
      };
    }
    const previousUpdateId =
      existing?.mode === 'update' && existing.updateId !== updateId
        ? existing.updateId
        : existing?.previousUpdateId;
    const recentRollbacks = mergeRollbackHistory(existing);
    return {
      kind: 'write',
      state: {
        mode: 'update',
        updateId,
        activeSourceUpdateId: updateId,
        ...(previousUpdateId ? { previousUpdateId } : {}),
        updatedAt: effectiveCreatedAt,
        ...(existing?.lastRollback
          ? { lastRollback: existing.lastRollback }
          : {}),
        ...(recentRollbacks ? { recentRollbacks } : {}),
      },
    };
  });

  if (result instanceof Response) {
    if (releaseResult.status === 'created' && env.OTA_BUCKET.delete) {
      await env.OTA_BUCKET.delete(releaseKey);
    }
    return result;
  }
  if ('idempotentResult' in result) {
    return jsonResponse(result.idempotentResult);
  }

  const state = result.state;
  return jsonResponse({
    ok: true,
    channel,
    platform: payload.platform,
    runtimeVersion: payload.runtimeVersion,
    updateId,
    ...(state.previousUpdateId
      ? { previousUpdateId: state.previousUpdateId }
      : {}),
  });
}
